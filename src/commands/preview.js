'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const yaml = require('js-yaml');
const open = require('open');
const { validateBcYamlAnatomy } = require('../utils/bc-yaml-validator');
const { validateIntegrationCoherence } = require('../utils/integration-validator');
const { validateOpenApiUseCases } = require('../utils/openapi-usecase-validator');
const { clientI18nScript, localeSwitcher, normalizeLocale, t } = require('../utils/i18n');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeJson(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, getKey) {
  const result = {};
  for (const item of asArray(items)) {
    const key = getKey(item) || 'none';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

async function readYamlIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  return yaml.load(await fs.readFile(filePath, 'utf8')) || {};
}

function metric(label, value, detail) {
  return { label, value, detail: detail || '' };
}

function countDiagnostics(diagnostics) {
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.filter((d) => d.level !== 'error').length;
  return { errors, warnings, total: diagnostics.length };
}

function diagnosticOwner(diagnostic) {
  const location = diagnostic.location || '';
  const match = location.match(/arch\/([^/]+)\/\1\.yaml/)
    || location.match(/arch\/([^/]+)\/\1-(?:open-api|internal-api|async-api)\.yaml/)
    || location.match(/arch\/([^/]+)\//);
  return match ? match[1] : 'system';
}

function buildAgentPrompt(title, context, files, ask) {
  const fileList = files.length ? files.join(', ') : 'arch/ design artifacts';
  return [
    `Review the DSL design decision "${title}".`,
    `Context: ${context}`,
    `Relevant files: ${fileList}.`,
    `Task: ${ask}`,
    'Keep the artifacts technology-agnostic and run the DSL validation/refinement checks after proposing changes.',
  ].join(' ');
}

function decision(id, scope, title, category, current, options, rationale, files, severity) {
  return {
    id,
    scope,
    title,
    category,
    current,
    options,
    rationale,
    files,
    severity: severity || 'review',
    prompt: buildAgentPrompt(title, current, files, `Evaluate the available options (${options.join(' | ')}) and update the design only if the current decision should change.`),
  };
}

function describeCounts(counts) {
  const parts = Object.entries(counts).map(([key, value]) => `${key}: ${value}`);
  return parts.length ? parts.join(', ') : 'none';
}

function operationCount(openApiDoc) {
  let total = 0;
  for (const pathItem of Object.values((openApiDoc && openApiDoc.paths) || {})) {
    for (const method of Object.keys(pathItem || {})) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) total++;
    }
  }
  return total;
}

function lifecycleEnumCount(bcYaml) {
  return asArray(bcYaml.enums).filter((enumDef) =>
    asArray(enumDef && enumDef.values).some((value) => asArray(value && value.transitions).length > 0)
  ).length;
}

function extractSystemDecisions(systemData) {
  if (!systemData) return [];
  const files = ['arch/system/system.yaml'];
  const bcs = asArray(systemData.boundedContexts);
  const integrations = asArray(systemData.integrations);
  const infrastructure = systemData.infrastructure || {};

  return [
    decision(
      'SYS-001',
      'system',
      'System profile',
      'strategic',
      `${systemData.system?.name || 'unnamed'} (${systemData.system?.domainType || 'unclassified'})`,
      ['core', 'supporting', 'generic'],
      'Confirms how much domain design investment the system deserves.',
      files
    ),
    decision(
      'SYS-002',
      'system',
      'Bounded context boundaries',
      'strategic',
      `${bcs.length} BC(s), type split: ${describeCounts(countBy(bcs, (bc) => bc.type))}`,
      ['keep current BCs', 'split oversized BCs', 'merge thin BCs', 'reclassify core/supporting/generic'],
      'BC boundaries drive ownership, language and downstream generation modules.',
      files
    ),
    decision(
      'SYS-003',
      'system',
      'Integration style',
      'strategic',
      `${integrations.length} integration(s), patterns: ${describeCounts(countBy(integrations, (item) => item.pattern))}, channels: ${describeCounts(countBy(integrations, (item) => item.channel))}`,
      ['customer-supplier http', 'event message-broker', 'acl', 'open-host', 'shared-kernel'],
      'This is the main coupling and availability map of the system.',
      files
    ),
    decision(
      'SYS-004',
      'system',
      'Infrastructure constraints',
      'strategic',
      `deployment=${infrastructure.deployment?.strategy || infrastructure.deploymentStrategy || 'default'}, database=${infrastructure.database?.type || infrastructure.databaseType || 'default'}, authServer=${String(Boolean(infrastructure.authServer))}, messageBroker=${String(Boolean(infrastructure.messageBroker))}`,
      ['modular-monolith', 'microservices', 'schema-per-bc', 'db-per-bc', 'auth server on/off', 'message broker on/off'],
      'Infrastructure flags explain why generated projects need shared auth or broker capabilities.',
      files
    ),
    decision(
      'SYS-005',
      'system',
      'External systems and sagas',
      'strategic',
      `${asArray(systemData.externalSystems).length} external system(s), ${asArray(systemData.sagas).length} saga(s), ${asArray(systemData.actors).length} actor type(s)`,
      ['declare external ACL', 'model saga', 'keep process inside one BC', 'declare actors for validation'],
      'External dependencies and cross-BC processes are high-value review points before generation.',
      files
    ),
  ];
}

function extractBcDecisions(bcYaml, contracts) {
  if (!bcYaml) return [];
  const bcName = bcYaml.bc;
  const files = [`arch/${bcName}/${bcName}.yaml`];
  const aggregates = asArray(bcYaml.aggregates);
  const useCases = asArray(bcYaml.useCases);
  const domainEvents = bcYaml.domainEvents || {};
  const outbound = asArray(bcYaml.integrations && bcYaml.integrations.outbound);
  const inbound = asArray(bcYaml.integrations && bcYaml.integrations.inbound);
  const readModels = aggregates.filter((aggregate) => aggregate && aggregate.readModel === true);
  const persistentProjections = asArray(bcYaml.projections).filter((projection) => projection && projection.persistent === true);
  const fkValidations = useCases.flatMap((uc) => asArray(uc && uc.fkValidations).map((fk) => ({ uc, fk })));
  const authUseCases = useCases.filter((uc) => uc && uc.authorization);
  const publicUseCases = useCases.filter((uc) => uc && uc.public === true);
  const httpUseCases = useCases.filter((uc) => uc && uc.trigger && uc.trigger.kind === 'http');
  const eventUseCases = useCases.filter((uc) => uc && uc.trigger && uc.trigger.kind === 'event');

  return [
    decision(
      `${bcName}-DM-001`,
      bcName,
      'Domain model shape',
      'domain-model',
      `${aggregates.length} aggregate(s), ${aggregates.reduce((sum, agg) => sum + asArray(agg && agg.entities).length, 0)} entity/entities, ${asArray(bcYaml.valueObjects).length} value object(s)`,
      ['aggregate', 'entity composition', 'entity aggregation', 'value object', 'projection'],
      'Confirms whether concepts are modeled with identity, ownership or value semantics.',
      files
    ),
    decision(
      `${bcName}-DM-002`,
      bcName,
      'State management',
      'domain-model',
      `${asArray(bcYaml.enums).length} enum(s), ${lifecycleEnumCount(bcYaml)} lifecycle enum(s) with transitions`,
      ['lifecycle enum with transitions', 'classification enum', 'boolean flag', 'domain rule gate'],
      'Lifecycle states define allowed transitions and event emission points.',
      files
    ),
    decision(
      `${bcName}-UC-001`,
      bcName,
      'Use case topology',
      'behavior',
      `${useCases.length} use case(s), ${describeCounts(countBy(useCases, (uc) => uc.type))}; triggers: http=${httpUseCases.length}, event=${eventUseCases.length}`,
      ['command', 'query', 'http trigger', 'event trigger', 'bulk', 'async', 'cacheable', 'idempotent'],
      'Use case shape determines whether behavior mutates state, exposes reads, or reacts to events.',
      files
    ),
    decision(
      `${bcName}-UC-002`,
      bcName,
      'Authorization strategy',
      'security',
      `${authUseCases.length} authorized use case(s), ${publicUseCases.length} public use case(s)`,
      ['public', 'rolesAnyOf', 'permissionsAnyOf', 'scopesAnyOf', 'ownership'],
      'Security choices should be visible to the designer before implementation.',
      files
    ),
    decision(
      `${bcName}-UC-003`,
      bcName,
      'Lookup and FK validation routes',
      'consistency',
      `${fkValidations.length} FK validation(s), ${useCases.filter((uc) => asArray(uc && uc.lookups).length > 0).length} use case(s) with lookups`,
      ['notFoundError', 'lookups[]', 'same-BC fkValidation', 'Local Read Model lookup', 'external ServicePort'],
      'These choices decide where referential integrity is checked and which dependencies appear.',
      files
    ),
    decision(
      `${bcName}-EV-001`,
      bcName,
      'Events and Local Read Models',
      'events',
      `${asArray(domainEvents.published).length} published event(s), ${asArray(domainEvents.consumed).length} consumed event(s), ${readModels.length + persistentProjections.length} local read model(s)`,
      ['publish event', 'consume event', 'listenerRequired false', 'persistent projection', 'readModel aggregate', 'HTTP sync instead of LRM'],
      'Event and LRM decisions control coupling, availability and eventual consistency trade-offs.',
      files
    ),
    decision(
      `${bcName}-INT-001`,
      bcName,
      'Integration points',
      'integration',
      `${outbound.length} outbound integration(s), ${inbound.length} inbound integration(s)`,
      ['outbound HTTP', 'inbound HTTP', 'event subscription', 'external ACL', 'resilience override', 'auth override'],
      'Integration declarations must align with system.yaml and contract artifacts.',
      files
    ),
    decision(
      `${bcName}-API-001`,
      bcName,
      'API contracts',
      'contracts',
      `public REST operations=${operationCount(contracts.openApi)}, internal REST operations=${operationCount(contracts.internalApi)}, async channels=${Object.keys((contracts.asyncApi && contracts.asyncApi.channels) || {}).length}`,
      ['public OpenAPI', 'internal OpenAPI', 'AsyncAPI publish', 'AsyncAPI subscribe', 'no external contract'],
      'Contract files are how the tactical design becomes reviewable by clients and other BCs.',
      files
    ),
    decision(
      `${bcName}-ERR-001`,
      bcName,
      'Error catalog',
      'errors',
      `${asArray(bcYaml.errors).length} declared error(s), HTTP status split: ${describeCounts(countBy(asArray(bcYaml.errors), (err) => err.httpStatus))}`,
      ['domain error', 'not found', 'conflict', 'validation error', 'manual-only error'],
      'Error catalog completeness affects generated exception contracts and API responses.',
      files
    ),
  ];
}

function buildPatchProposals(reviewModel) {
  const diagnosticProposals = reviewModel.diagnostics.map((diagnostic, index) => ({
    id: `DIAG-${String(index + 1).padStart(3, '0')}`,
    title: `[${diagnostic.code}] ${diagnostic.message}`,
    severity: diagnostic.level === 'error' ? 'error' : 'warning',
    rationale: 'Validation found a design inconsistency that should be reviewed before generation.',
    affectedFiles: [diagnostic.location || 'arch/'],
    current: diagnostic.location || 'unknown location',
    proposed: 'Ask the design agent to inspect the referenced YAML path and update the canonical artifacts consistently.',
    agentPrompt: buildAgentPrompt(
      `[${diagnostic.code}] ${diagnostic.message}`,
      diagnostic.location || 'unknown location',
      [diagnostic.location || 'arch/'],
      'Fix this validation diagnostic by updating the canonical design artifacts and any related contract files.'
    ),
  }));

  const decisionProposals = reviewModel.decisions
    .filter((item) => item.category === 'integration' || item.category === 'events' || item.category === 'consistency')
    .map((item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      rationale: item.rationale,
      affectedFiles: item.files,
      current: item.current,
      proposed: `Review options: ${item.options.join(' | ')}`,
      agentPrompt: item.prompt,
    }));

  return [...diagnosticProposals, ...decisionProposals];
}

function buildBcMetrics(bcDoc, diagnostics) {
  if (!bcDoc) return [
    { label: 'Status', value: 'Pending', detail: 'no tactical design' },
    { label: 'Diagnostics', value: diagnostics.length, detail: `${countDiagnostics(diagnostics).errors} errors, ${countDiagnostics(diagnostics).warnings} warnings` },
  ];

  const aggregates = asArray(bcDoc.aggregates);
  const useCases = asArray(bcDoc.useCases);
  const published = asArray(bcDoc.domainEvents && bcDoc.domainEvents.published);
  const consumed = asArray(bcDoc.domainEvents && bcDoc.domainEvents.consumed);
  const readModels = aggregates.filter((item) => item && item.readModel === true).length
    + asArray(bcDoc.projections).filter((item) => item && item.persistent === true).length;
  const useCaseTypes = countBy(useCases, (uc) => uc.type);
  const outbound = asArray(bcDoc.integrations && bcDoc.integrations.outbound);
  const inbound = asArray(bcDoc.integrations && bcDoc.integrations.inbound);

  return [
    { label: 'Aggregates', value: aggregates.length, detail: `${aggregates.reduce((sum, aggregate) => sum + asArray(aggregate && aggregate.entities).length, 0)} entities` },
    { label: 'Use cases', value: useCases.length, detail: `${useCaseTypes.command || 0} commands, ${useCaseTypes.query || 0} queries` },
    { label: 'Events', value: published.length + consumed.length, detail: `${published.length} published, ${consumed.length} consumed` },
    { label: 'Integrations', value: outbound.length + inbound.length, detail: `${outbound.length} outbound, ${inbound.length} inbound` },
    { label: 'Read models', value: readModels, detail: 'readModel aggregates + persistent projections' },
    { label: 'Diagnostics', value: diagnostics.length, detail: `${countDiagnostics(diagnostics).errors} errors, ${countDiagnostics(diagnostics).warnings} warnings` },
  ];
}

function diagnosticsForOwner(diagnostics, bcName) {
  return diagnostics.filter((diagnostic) => diagnosticOwner(diagnostic) === bcName || String(diagnostic.message || '').includes(`"${bcName}"`));
}

// ─── Dereference internal $refs at build time ─────────────────────────────────
// Resolves all #/... JSON Pointer refs so the embedded spec is self-contained.
// Swagger UI v5 (which supports OpenAPI 3.1) requires a valid base URL for its
// resolver — but in file:// context there is none. By removing every $ref here
// in Node.js, the browser-side resolver has nothing to fetch.
function dereferenceSpec(spec) {
  const seen = new WeakSet();

  function resolvePointer(ref, root) {
    if (!ref.startsWith('#/')) return null;
    const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = root;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[part];
    }
    return cur ?? null;
  }

  function walk(node, root) {
    if (!node || typeof node !== 'object') return node;
    if (seen.has(node)) return node; // circular-ref guard
    seen.add(node);

    if (Array.isArray(node)) return node.map((item) => walk(item, root));

    if ('$ref' in node && typeof node.$ref === 'string') {
      const target = resolvePointer(node.$ref, root);
      if (target != null) return walk(target, root);
      return node; // unresolvable external ref — leave as-is
    }

    const result = {};
    for (const [k, v] of Object.entries(node)) {
      result[k] = walk(v, root);
    }
    return result;
  }

  return walk(spec, spec);
}

// ─── Schema table (used in AsyncAPI viewer) ───────────────────────────────────

function i18nSpan(key, locale, params = {}) {
  return `<span data-i18n="${escapeHtml(key)}">${escapeHtml(t(locale, key, params))}</span>`;
}

function i18nText(key, locale, params = {}) {
  return escapeHtml(t(locale, key, params));
}

function renderSchemaTable(schema, allSchemas, locale = 'es') {
  if (!schema) return `<p class="text-muted small mb-0" data-i18n="schema.noSchema">${i18nText('schema.noSchema', locale)}</p>`;

  if (schema.$ref) {
    const key = schema.$ref.split('/').pop();
    schema = allSchemas[key] || schema;
  }

  if (!schema.properties) {
    return `<pre class="bg-light p-2 rounded mb-0" style="font-size:.78rem;white-space:pre-wrap">${escapeHtml(JSON.stringify(schema, null, 2))}</pre>`;
  }

  const required = schema.required || [];
  let rows = '';
  for (const [prop, def] of Object.entries(schema.properties)) {
    const resolvedDef = def.$ref
      ? allSchemas[def.$ref.split('/').pop()] || def
      : def;
    const type = resolvedDef.type || (def.$ref ? def.$ref.split('/').pop() : def.format || '—');
    const isRequired = required.includes(prop);
    const desc =
      resolvedDef.description ||
      (resolvedDef.example !== undefined ? `Example: ${String(resolvedDef.example)}` : '');
    rows += `
      <tr>
        <td class="font-monospace" style="font-size:.85rem">${escapeHtml(prop)}${isRequired ? ' <span class="text-danger fw-bold" title="required">*</span>' : ''}</td>
        <td><span class="badge bg-light text-dark border" style="font-size:.73rem">${escapeHtml(String(type))}</span></td>
        <td class="text-muted" style="font-size:.82rem">${escapeHtml(desc)}</td>
      </tr>`;
  }

  return `
    <table class="table table-sm table-hover mt-2 mb-0" style="font-size:.85rem">
      <thead class="table-light">
        <tr><th style="width:28%" data-i18n="schema.field">${i18nText('schema.field', locale)}</th><th style="width:16%" data-i18n="schema.type">${i18nText('schema.type', locale)}</th><th data-i18n="schema.description">${i18nText('schema.description', locale)}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Channel card (AsyncAPI) ───────────────────────────────────────────────────

function buildChannelCard(channelName, channelDef, messages, schemas, locale = 'es') {
  const op = channelDef.publish ? 'publish' : 'subscribe';
  const opDef = channelDef[op] || {};

  const msgRef = opDef.message && opDef.message.$ref;
  const msgKey = msgRef ? msgRef.split('/').pop() : null;
  const msgDef = msgKey ? (messages[msgKey] || opDef.message || {}) : (opDef.message || {});

  const payloadRef = msgDef.payload && msgDef.payload.$ref;
  const schemaKey = payloadRef ? payloadRef.split('/').pop() : null;
  const schema = schemaKey ? (schemas[schemaKey] || {}) : (msgDef.payload || {});

  const opLabel = op === 'publish' ? `&#11014; ${i18nText('async.publish', locale)}` : `&#11015; ${i18nText('async.subscribe', locale)}`;
  const opClass = op === 'publish' ? 'bg-success' : 'bg-primary';
  const summary = opDef.summary ? `<p class="text-muted small mb-2">${escapeHtml(opDef.summary)}</p>` : '';
  const msgSummary = msgDef.summary ? `<p class="text-muted small mb-2">${escapeHtml(msgDef.summary)}</p>` : '';

  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center py-2">
        <code style="font-size:.9rem">${escapeHtml(channelName)}</code>
        <span class="badge ${opClass} text-white">${opLabel}</span>
      </div>
      <div class="card-body pb-2">
        ${summary}
        <p class="mb-1 small"><strong data-i18n="async.message">${i18nText('async.message', locale)}</strong>: ${escapeHtml(msgDef.name || msgKey || 'anonymous')}</p>
        ${msgSummary}
        ${renderSchemaTable(schema, schemas, locale)}
      </div>
    </div>`;
}

// ─── Diagram classification ─────────────────────────────────────────────────────
// Groups .mmd files by type using deterministic suffix matching.
// Returns: { overview, domainModel, states: [{title,fileName,kind,content}], sequences: [...] }

function humanizeDiagramName(filename, bcName) {
  // Strip bc prefix and extension: "catalog-diagram-product-activated-seq" → "Product Activated"
  const base = filename.replace(/\.mmd$/, '');
  const withoutBc = base.replace(new RegExp(`^${bcName}-diagram-?`), '');
  if (!withoutBc || withoutBc === base) return base;
  return withoutBc
    .replace(/-seq$/, '')
    .replace(/-states$/, ' States')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Sanitize Mermaid source to fix common DDD annotation patterns that are not
// valid Mermaid syntax but are produced by the design skills.
function sanitizeMermaidSource(src) {
  if (/^classDiagram\b/.test(src)) {
    // 1. Strip DDD annotations: `+Uuid id  [readOnly, generated]`,
    //    `[pattern: ^[A-Z]{3}$]` (may contain nested brackets).
    //    Use greedy .+ so nested [] inside annotation values are consumed.
    src = src.replace(/^(\s+[+\-#~]?[^\n{]+?)\s+\[.+\]\s*$/gm, '$1');

    // 2. Strip type length/precision constraints so Mermaid does not mis-parse
    //    them as method calls: String(200) → String, Decimal(19,4) → Decimal.
    src = src.replace(/\b([A-Za-z][A-Za-z0-9]*)\(\d+(?:,\d+)?\)/g, '$1');

    // 3. Strip optional-param markers: description? → description.
    src = src.replace(/(\w)\?/g, '$1');
  }
  // All diagrams: em dash — (U+2014) is not a valid Mermaid token.
  src = src.replace(/\u2014/g, '-');
  return src;
}

async function classifyDiagrams(bcDir, bcName) {
  const diagramsDir = path.join(bcDir, 'diagrams');
  const result = { overview: null, domainModel: null, states: [], sequences: [] };

  if (!(await fs.pathExists(diagramsDir))) return result;

  const files = (await fs.readdir(diagramsDir)).filter((f) => f.endsWith('.mmd')).sort();

  for (const file of files) {
    // Replace literal \n sequences with a space.
    // In .mmd files \n is used inside node labels (e.g. `["UC-CAT-001\nCreateCategory"]`)
    // and as state description suffixes (e.g. `ACTIVE : ACTIVE\nVisible...`).
    // Inserting a real newline breaks stateDiagram-v2 parsing; stripping too aggressively
    // removes closing brackets. A space keeps labels readable and valid across all diagram types.
    const raw = await fs.readFile(path.join(diagramsDir, file), 'utf8');
    // Normalize line endings then replace literal \n escape sequences inside
    // node labels (e.g. `["Title\nSubtitle"]`) with a space so Mermaid
    // stateDiagram-v2 / flowchart parsers don't choke on them.
    const content = sanitizeMermaidSource(
      raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\n/g, ' ')
        .trim()
    );
    const base = file.replace(/\.mmd$/, '');

    if (base === `${bcName}-diagram`) {
      result.overview = { title: 'Overview', fileName: file, kind: 'overview', content };
    } else if (base.endsWith('-domain-model')) {
      result.domainModel = { title: 'Domain Model', fileName: file, kind: 'domain-model', content };
    } else if (base.endsWith('-states')) {
      result.states.push({ title: humanizeDiagramName(file, bcName), fileName: file, kind: 'states', content });
    } else if (base.endsWith('-seq')) {
      result.sequences.push({ title: humanizeDiagramName(file, bcName), fileName: file, kind: 'sequence', content });
    }
  }

  return result;
}

// ─── Design page (diagrams) ───────────────────────────────────────────────────

function buildDesignHtml(bcName, diagramGroups, openApiFile, asyncApiFile, locale = 'es') {
  const tabs = [];
  const panes = [];
  const diagramSources = []; // collected in order: { id, title, fileName, kind, source, isSeq }

  let diagIdx = 0;

  function addTab(id, label, html) {
    const isFirst = tabs.length === 0;
    tabs.push(
      `<li class="nav-item" role="presentation">
        <button class="nav-link${isFirst ? ' active' : ''}" id="tab-${id}" data-bs-toggle="tab"
          data-bs-target="#pane-${id}" type="button" role="tab">${label}</button>
      </li>`
    );
    panes.push(
      `<div class="tab-pane fade${isFirst ? ' show active' : ''}" id="pane-${id}" role="tabpanel">
        ${html}
      </div>`
    );
  }

  function diagramPlaceholder(diagram, isSeq) {
    const id = `diag-${diagIdx++}`;
    diagramSources.push({ id, title: diagram.title, fileName: diagram.fileName, kind: diagram.kind, source: diagram.content, isSeq });
    const wrapClass = isSeq ? 'diagram-wrap seq-wrap' : 'diagram-wrap';
    return `<div class="${wrapClass}" tabindex="0" data-diagram-wrap="${id}">
      <div class="diagram-toolbar" aria-label="Diagram controls">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-zoom="in" data-i18n-title="diagram.zoomIn" title="${i18nText('diagram.zoomIn', locale)}">+</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-zoom="out" data-i18n-title="diagram.zoomOut" title="${i18nText('diagram.zoomOut', locale)}">-</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-zoom="fit" data-i18n="diagram.fitWidth">${i18nText('diagram.fitWidth', locale)}</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-zoom="reset" data-i18n="diagram.reset">${i18nText('diagram.reset', locale)}</button>
      </div>
      <div class="diagram-hint small text-muted" data-i18n="diagram.dragHint">${i18nText('diagram.dragHint', locale)}</div>
      <div id="${id}" class="diag-target"><pre class="mermaid" data-diagram-id="${id}">${escapeHtml(diagram.content)}</pre></div>
    </div>`;
  }

  if (diagramGroups.overview) {
    addTab('overview', i18nText('diagram.overview', locale), diagramPlaceholder(diagramGroups.overview, false));
  }
  if (diagramGroups.domainModel) {
    addTab('domain', i18nText('diagram.domainModel', locale), diagramPlaceholder(diagramGroups.domainModel, false));
  }
  if (diagramGroups.states.length) {
    const html = diagramGroups.states
      .map((d) => `<h6 class="diagram-title">${escapeHtml(d.title)}</h6>${diagramPlaceholder(d, false)}`)
      .join('');
    addTab('states', `${i18nText('diagram.states', locale)} <span class="badge bg-secondary ms-1">${diagramGroups.states.length}</span>`, html);
  }
  if (diagramGroups.sequences.length) {
    const html = diagramGroups.sequences
      .map((d) => `<h6 class="diagram-title">${escapeHtml(d.title)}</h6>${diagramPlaceholder(d, true)}`)
      .join('');
    addTab('seq', `${i18nText('diagram.sequences', locale)} <span class="badge bg-secondary ms-1">${diagramGroups.sequences.length}</span>`, html);
  }

  if (!tabs.length) {
    return null;
  }

  const apiLinks = [
    openApiFile ? `<a href="${escapeHtml(openApiFile)}" class="btn btn-sm btn-outline-success" data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</a>` : '',
    asyncApiFile ? `<a href="${escapeHtml(asyncApiFile)}" class="btn btn-sm btn-outline-primary" data-i18n="nav.events">${i18nText('nav.events', locale)}</a>` : '',
  ].filter(Boolean).join('');

  // Diagram sources as a JS literal — JSON.stringify handles all escaping
  const diagramsJs = `const DIAGRAMS = ${JSON.stringify(diagramSources)};`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcName)} — ${i18nText('nav.diagrams', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    body { background: #f5f6f8; }
    .diagram-wrap {
      background: #fff;
      border: 1px solid #dee2e6;
      border-radius: .5rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      text-align: center;
      overflow: auto;
      min-height: 280px;
      position: relative;
    }
    .seq-wrap { text-align: left; }
    .diag-target { display: inline-block; max-width: none; transform-origin: 0 0; cursor: grab; }
    .diag-target.dragging { cursor: grabbing; }
    .seq-wrap .diag-target { display: block; min-width: 600px; }
    .diagram-toolbar { display: flex; gap: .35rem; justify-content: flex-end; flex-wrap: wrap; margin-bottom: .5rem; position: sticky; top: 0; z-index: 2; background: rgba(255,255,255,.92); padding-bottom: .25rem; }
    .diagram-hint { text-align: right; margin-bottom: .75rem; }
    .diag-error pre {
      background: #fff8e1; border: 1px solid #ffe082; border-radius: .4rem;
      padding: 1rem; font-size: .78rem; text-align: left; white-space: pre-wrap; margin: 0;
    }
    .diag-error .error-message { background: #fff3cd; border: 1px solid #ffecb5; border-radius: .4rem; padding: .75rem; text-align: left; margin-bottom: .75rem; }
    .line-no { color: #6c757d; user-select: none; display: inline-block; width: 3.5rem; }
    .prompt-box { background: #111827; color: #e5e7eb; border-radius: .4rem; padding: .9rem; margin-top: .5rem; white-space: pre-wrap; font-size: .78rem; text-align: left; }
    .diagram-title { color: #495057; font-size: .85rem; font-weight: 600; margin-bottom: .5rem; text-transform: uppercase; letter-spacing: .04em; }
    .nav-tabs .nav-link { font-size: .9rem; }
    .loading-spinner { color: #adb5bd; font-size: .85rem; padding: 2rem; }
    .diag-target svg { display: block; max-width: none; height: auto; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(bcName)} — <span data-i18n="nav.diagrams">${i18nText('nav.diagrams', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">${apiLinks}${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <div class="container-xl pb-5">
    <ul class="nav nav-tabs mb-4" role="tablist">
      ${tabs.join('\n      ')}
    </ul>
    <div class="tab-content">
      ${panes.join('\n      ')}
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"><\/script>
  ${clientI18nScript(locale)}
  <script>
    ${diagramsJs}
    mermaid.initialize({ startOnLoad: false, theme: 'default' });

    const rendered = new Set(); // ids successfully rendered
    const failed  = new Set(); // ids that threw — no retry

    function escapeText(value) {
      return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function numberedSource(source) {
      return String(source || '').split('\\n').map((line, index) =>
        '<span class="line-no">' + String(index + 1).padStart(3, ' ') + '</span>' + escapeText(line)
      ).join('\\n');
    }

    function setupPanZoom(target) {
      const wrap = target.closest('.diagram-wrap');
      const svg = target.querySelector('svg');
      if (!wrap || !svg || target.dataset.panZoomReady) return;
      target.dataset.panZoomReady = 'true';
      let scale = 1;
      let x = 0;
      let y = 0;
      let dragging = false;
      let startX = 0;
      let startY = 0;

      // Return the current SVG's natural width from its viewBox.
      // This is evaluated lazily so it still works if Mermaid finishes its
      // async render passes (and sets the viewBox) after setupPanZoom runs.
      function getNatWidth() {
        const cur = target.querySelector('svg');
        if (cur && cur.viewBox && cur.viewBox.baseVal.width > 1) return cur.viewBox.baseVal.width;
        // Fallback: captured value from setup time
        return (svg.viewBox && svg.viewBox.baseVal.width > 1)
          ? svg.viewBox.baseVal.width
          : (svg.getBoundingClientRect().width || 300);
      }

      function apply() {
        // Re-query the SVG each time — Mermaid may have replaced the original
        // SVG element during its async rendering pipeline (stale-reference guard).
        const currentSvg = target.querySelector('svg');
        if (!currentSvg) return;
        const natW = getNatWidth();
        // Set an explicit pixel width on the SVG so the layout box reflects
        // the scaled size (transforms don't affect layout, but width does).
        currentSvg.style.width = Math.round(natW * scale) + 'px';
        currentSvg.style.height = 'auto';
        currentSvg.style.maxWidth = 'none';
        target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
      }
      function zoom(delta) {
        scale = Math.min(4, Math.max(0.25, Math.round((scale + delta) * 100) / 100));
        apply();
      }
      function reset() {
        scale = 1;
        x = 0;
        y = 0;
        apply();
      }
      function fit() {
        const available = Math.max(240, wrap.clientWidth - 48);
        const natW = getNatWidth();
        // No hard minimum so fit-to-width always fills the container exactly.
        scale = Math.min(2.5, Math.max(0.05, available / natW));
        x = 0;
        y = 0;
        apply();
      }

      wrap.querySelectorAll('[data-zoom]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-zoom');
          if (action === 'in') zoom(0.15);
          if (action === 'out') zoom(-0.15);
          if (action === 'reset') reset();
          if (action === 'fit') fit();
        });
      });
      wrap.addEventListener('keydown', (event) => {
        if (event.key === '+') { event.preventDefault(); zoom(0.15); }
        if (event.key === '-') { event.preventDefault(); zoom(-0.15); }
        if (event.key === '0') { event.preventDefault(); reset(); }
      });
      target.addEventListener('pointerdown', (event) => {
        dragging = true;
        target.classList.add('dragging');
        startX = event.clientX - x;
        startY = event.clientY - y;
        target.setPointerCapture(event.pointerId);
      });
      target.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        x = event.clientX - startX;
        y = event.clientY - startY;
        apply();
      });
      target.addEventListener('pointerup', (event) => {
        dragging = false;
        target.classList.remove('dragging');
        target.releasePointerCapture(event.pointerId);
      });
      // Auto-fit after SVG is painted. Two RAF passes give Mermaid's async
      // rendering pipeline time to complete before we read the viewBox and apply.
      requestAnimationFrame(() => requestAnimationFrame(() => fit()));
    }

    function showError(el, d, errorMessage) {
      el.className = 'diag-error';
      const prompt = (window.dslT ? window.dslT('diagram.correctPrompt') : '${i18nText('diagram.correctPrompt', locale)}') + '\\n\\nDiagram: ' + (d.fileName || d.title || d.id) + '\\nKind: ' + (d.kind || 'unknown') + '\\nError: ' + errorMessage;
      el.innerHTML =
        '<div class="error-message">' +
        '<div class="text-warning small mb-2 fw-semibold">&#9888; <span data-i18n="diagram.syntaxError">' + (window.dslT ? window.dslT('diagram.syntaxError') : '${i18nText('diagram.syntaxError', locale)}') + '</span></div>' +
        '<p class="small mb-1"><strong>' + escapeText(d.fileName || d.title || d.id) + '</strong></p>' +
        '<p class="small mb-0"><span data-i18n="diagram.errorMessage">' + (window.dslT ? window.dslT('diagram.errorMessage') : '${i18nText('diagram.errorMessage', locale)}') + '</span>: ' + escapeText(errorMessage) + '</p>' +
        '</div>' +
        '<details class="mb-3"><summary class="small fw-semibold" data-i18n="diagram.promptTitle">' + (window.dslT ? window.dslT('diagram.promptTitle') : '${i18nText('diagram.promptTitle', locale)}') + '</summary><pre class="prompt-box"><code>' + escapeText(prompt) + '</code></pre></details>' +
        '<div class="text-muted small mb-2 fw-semibold" data-i18n="diagram.rawSource">' + (window.dslT ? window.dslT('diagram.rawSource') : '${i18nText('diagram.rawSource', locale)}') + '</div>' +
        '<pre>' + numberedSource(d.source) + '</pre>';
    }

    // Apply pan/zoom as soon as Mermaid marks an element as processed.
    const panZoomObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.attributeName === 'data-processed') {
          const preEl = mut.target;
          if (preEl.getAttribute('data-processed') === 'true') {
            const diagTarget = preEl.closest('.diag-target');
            if (diagTarget) setupPanZoom(diagTarget);
          }
        }
      }
    });
    document.querySelectorAll('.mermaid').forEach((el) =>
      panZoomObserver.observe(el, { attributes: true, attributeFilter: ['data-processed'] })
    );
    // Fallback: if Mermaid's startOnLoad already processed elements before the
    // observer was attached, set up pan/zoom for them now.
    document.querySelectorAll('.mermaid[data-processed="true"]').forEach((preEl) => {
      const diagTarget = preEl.closest('.diag-target');
      if (diagTarget) setupPanZoom(diagTarget);
    });

    // Render only diagrams inside the given Bootstrap tab pane.
    // We call mermaid.parse() first — mermaid.run() with suppressErrors:true
    // renders the bomb icon without throwing, so parse() is the only reliable
    // way to detect syntax errors and show our own error panel.
    async function renderDiagramsInPane(pane) {
      for (const d of DIAGRAMS) {
        if (rendered.has(d.id) || failed.has(d.id)) continue;
        const el = document.getElementById(d.id);
        if (!el || !pane.contains(el)) continue;
        const preEl = el.querySelector('.mermaid');
        if (!preEl) continue;
        // If Mermaid already rendered this element (e.g. via startOnLoad default),
        // just mark it rendered and set up pan/zoom without re-running mermaid.
        if (preEl.getAttribute('data-processed') === 'true') {
          rendered.add(d.id);
          setupPanZoom(el);
          continue;
        }
        // textContent gives decoded text (HTML entities resolved by the browser)
        const source = preEl.textContent.trim();
        try {
          await mermaid.parse(source); // throws ParseError on invalid syntax
        } catch (parseErr) {
          failed.add(d.id);
          showError(el, d, parseErr.message || String(parseErr));
          continue;
        }
        try {
          await mermaid.run({ nodes: [preEl], suppressErrors: true });
          rendered.add(d.id);
          // Call setupPanZoom directly — the SVG is guaranteed to be in the DOM
          // now that mermaid.run() has resolved. The MutationObserver alone is
          // unreliable because Mermaid may set data-processed before inserting
          // the SVG, causing the observer to fire when querySelector('svg') is null.
          setupPanZoom(el);
        } catch (runErr) {
          failed.add(d.id);
          showError(el, d, runErr.message || String(runErr));
        }
      }
    }

    // On tab switch, render the newly visible pane.
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach((btn) => {
      btn.addEventListener('shown.bs.tab', () => {
        const paneId = btn.getAttribute('data-bs-target');
        const pane = document.querySelector(paneId);
        if (pane) renderDiagramsInPane(pane);
      });
    });

    // Initial render: only the active pane. Deferred one tick so Mermaid
    // completes its internal async initialization first.
    setTimeout(() => {
      const activePane = document.querySelector('.tab-pane.show.active');
      if (activePane) renderDiagramsInPane(activePane);
    }, 0);
  <\/script>
</body>
</html>`;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function severityClass(level) {
  if (level === 'error') return 'danger';
  if (level === 'warn' || level === 'warning') return 'warning text-dark';
  return 'secondary';
}

function renderMetricTiles(metrics) {
  return `
    <div class="row g-3 mb-4">
      ${metrics.map((item) => `
        <div class="col-6 col-lg-2">
          <div class="metric-tile">
            <div class="metric-value">${escapeHtml(item.value)}</div>
            <div class="metric-label">${escapeHtml(item.label)}</div>
            ${item.detail ? `<div class="metric-detail">${escapeHtml(item.detail)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

function renderDecisionCards(decisions, locale = 'es') {
  if (!decisions.length) return `<p class="text-muted small" data-i18n="ui.noDecisions">${i18nText('ui.noDecisions', locale)}</p>`;
  return decisions.map((item) => `
    <article class="decision-card" data-category="${escapeHtml(item.category)}">
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
        <div>
          <span class="decision-id">${escapeHtml(item.id)}</span>
          <h6 class="mb-1">${escapeHtml(item.title)}</h6>
        </div>
        <span class="badge bg-light text-dark border">${escapeHtml(item.category)}</span>
      </div>
      <p class="small mb-2"><strong data-i18n="ui.current">${i18nText('ui.current', locale)}</strong>: ${escapeHtml(item.current)}</p>
      <p class="small text-muted mb-2">${escapeHtml(item.rationale)}</p>
      <div class="option-row mb-3">
        ${asArray(item.options).map((option) => `<span class="badge rounded-pill text-bg-secondary">${escapeHtml(option)}</span>`).join('')}
      </div>
      <details>
        <summary class="small fw-semibold" data-i18n="ui.promptForAgent">${i18nText('ui.promptForAgent', locale)}</summary>
        <pre class="prompt-box"><code>${escapeHtml(item.prompt)}</code></pre>
      </details>
    </article>`).join('');
}

function renderDiagnostics(diagnostics, locale = 'es') {
  if (!diagnostics.length) return `<div class="alert alert-success small mb-0" data-i18n="ui.noDiagnostics">${i18nText('ui.noDiagnostics', locale)}</div>`;
  return `
    <div class="list-group diagnostic-list">
      ${diagnostics.map((item) => `
        <div class="list-group-item">
          <div class="d-flex justify-content-between align-items-start gap-3">
            <div>
              <span class="badge bg-${severityClass(item.level)} me-2">${escapeHtml(item.level || 'warn')}</span>
              <strong>${escapeHtml(item.code)}</strong>
            </div>
            <code class="small text-muted">${escapeHtml(item.location || '')}</code>
          </div>
          <p class="small mb-0 mt-2">${escapeHtml(item.message)}</p>
        </div>`).join('')}
    </div>`;
}

function buildBcReviewHtml(bcReview, generatedAt, locale = 'es') {
  const health = countDiagnostics(bcReview.diagnostics);
  const linkButtons = [
    bcReview.links.designFile ? `<a class="btn btn-sm btn-outline-dark" href="${escapeHtml(bcReview.links.designFile)}" data-i18n="nav.diagrams">${i18nText('nav.diagrams', locale)}</a>` : '',
    bcReview.links.openApiFile ? `<a class="btn btn-sm btn-outline-success" href="${escapeHtml(bcReview.links.openApiFile)}" data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</a>` : '',
    bcReview.links.asyncApiFile ? `<a class="btn btn-sm btn-outline-primary" href="${escapeHtml(bcReview.links.asyncApiFile)}" data-i18n="nav.events">${i18nText('nav.events', locale)}</a>` : '',
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcReview.name)} — ${i18nText('ui.decisionReview', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #f5f6f8; color: #20242a; }
    .metric-tile, .decision-card { background: #fff; border: 1px solid #dde2e8; border-radius: .5rem; padding: 1rem; }
    .metric-value { font-size: 1.45rem; font-weight: 700; line-height: 1; }
    .metric-label { font-size: .8rem; color: #56606b; margin-top: .35rem; }
    .metric-detail { font-size: .72rem; color: #7a8490; margin-top: .2rem; }
    .decision-card { margin-bottom: 1rem; }
    .decision-id { font-size: .72rem; color: #65717e; text-transform: uppercase; letter-spacing: .04em; }
    .option-row { display: flex; flex-wrap: wrap; gap: .35rem; }
    .prompt-box { background: #111827; color: #e5e7eb; border-radius: .4rem; padding: .9rem; margin-top: .5rem; white-space: pre-wrap; font-size: .78rem; }
    .diagnostic-list code { white-space: normal; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(bcReview.name)} — <span data-i18n="ui.decisionReview">${i18nText('ui.decisionReview', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">${linkButtons}${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <main class="container-xl pb-5">
    <div class="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
      <div>
        <h1 class="h4 mb-1">${escapeHtml(bcReview.name)}</h1>
        <p class="text-muted mb-0">${bcReview.purpose ? escapeHtml(bcReview.purpose) : i18nSpan('ui.noPurpose', locale)}</p>
      </div>
      <div class="text-end small text-muted">
        <div>${escapeHtml(generatedAt)}</div>
        <div><span class="badge bg-${health.errors ? 'danger' : (health.warnings ? 'warning text-dark' : 'success')}">${i18nText('ui.errorsWarnings', locale, health)}</span></div>
      </div>
    </div>

    ${renderMetricTiles(bcReview.metrics)}

    <section class="mb-5">
      <h2 class="h5 mb-3" data-i18n="ui.designDecisions">${i18nText('ui.designDecisions', locale)}</h2>
      ${renderDecisionCards(bcReview.decisions, locale)}
    </section>

    <section>
      <h2 class="h5 mb-3" data-i18n="ui.validationHealth">${i18nText('ui.validationHealth', locale)}</h2>
      ${renderDiagnostics(bcReview.diagnostics, locale)}
    </section>
  </main>
  ${clientI18nScript(locale)}
</body>
</html>`;
}

function buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt, reviewModel, patchFile, locale = 'es') {
  const systemName = systemData?.system?.name ?? t(locale, 'ui.designReview');
  const systemDesc = systemData?.system?.description ?? '';
  const health = reviewModel ? countDiagnostics(reviewModel.diagnostics) : { errors: 0, warnings: 0, total: 0 };
  const systemMetrics = reviewModel ? [
    metric('BCs', reviewModel.boundedContexts.length, 'bounded contexts'),
    metric(t(locale, 'ui.decisions'), reviewModel.decisions.length, 'review points'),
    metric(t(locale, 'ui.diagnostics'), health.total, t(locale, 'ui.errorsWarnings', health)),
    metric(t(locale, 'ui.integrations'), asArray(systemData?.integrations).length, 'system integrations'),
    metric(t(locale, 'ui.externalSystems'), asArray(systemData?.externalSystems).length, 'declared dependencies'),
    metric(t(locale, 'ui.sagas'), asArray(systemData?.sagas).length, 'cross-BC processes'),
  ] : [];

  const typeBadgeClass = { core: 'primary', supporting: 'purple', generic: 'secondary' };

  const cards = bcCards.map((bc) => {
    const badgeClass = typeBadgeClass[bc.type] || 'secondary';
    const aggregateList = bc.aggregates?.length
      ? `<p class="small mb-2"><strong>Aggregates:</strong> ${bc.aggregates.map((a) => escapeHtml(a.name)).join(', ')}</p>`
      : '';

    let footer;
    if (bc.hasDesign) {
      const links = [
        bc.reviewFile ? `<a href="${escapeHtml(bc.reviewFile)}" class="btn btn-sm btn-dark" data-i18n="nav.review">${i18nText('nav.review', locale)}</a>` : '',
        bc.designFile ? `<a href="${escapeHtml(bc.designFile)}" class="btn btn-sm btn-outline-dark" data-i18n="nav.diagrams">${i18nText('nav.diagrams', locale)}</a>` : '',
        bc.openApiFile ? `<a href="${escapeHtml(bc.openApiFile)}" class="btn btn-sm btn-outline-success" data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</a>` : '',
        bc.asyncApiFile ? `<a href="${escapeHtml(bc.asyncApiFile)}" class="btn btn-sm btn-outline-primary" data-i18n="nav.events">${i18nText('nav.events', locale)}</a>` : '',
      ].filter(Boolean);
      footer = links.length
        ? `<div class="d-flex gap-2 flex-wrap">${links.join('')}</div>`
        : `<span class="text-muted small" data-i18n="ui.designedNoContracts">${i18nText('ui.designedNoContracts', locale)}</span>`;
    } else {
      footer = `<span class="badge bg-warning text-dark" data-i18n="ui.pendingTactical">${i18nText('ui.pendingTactical', locale)}</span>`;
    }

    return `
      <div class="col-sm-6 col-lg-4">
        <div class="card h-100 bc-card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h6 class="card-title mb-0 fw-semibold">${escapeHtml(bc.name)}</h6>
              <span class="badge bg-${badgeClass}">${escapeHtml(bc.type)}</span>
            </div>
            <p class="card-text text-muted" style="font-size:.82rem">${escapeHtml(bc.purpose ?? '')}</p>
            ${aggregateList}
          </div>
          <div class="card-footer bg-transparent border-top-0 pb-3">${footer}</div>
        </div>
      </div>`;
  }).join('');

  const diagramSection = systemDiagram
    ? `
      <section class="mb-5">
        <h5 class="mb-3" data-i18n="ui.systemArchitecture">${i18nText('ui.systemArchitecture', locale)}</h5>
        <div class="bg-white rounded border p-4 overflow-auto">
          <div class="mermaid">${escapeHtml(systemDiagram)}</div>
        </div>
      </section>`
    : '';

  const descAlert = systemDesc
    ? `<div class="alert alert-secondary mb-4" style="font-size:.9rem">${escapeHtml(systemDesc)}</div>`
    : '';

  const reviewIntro = reviewModel ? `
    <section class="mb-5">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <h5 class="mb-0" data-i18n="ui.decisionReview">${i18nText('ui.decisionReview', locale)}</h5>
        <div class="d-flex gap-2 flex-wrap">
          <span class="badge bg-${health.errors ? 'danger' : (health.warnings ? 'warning text-dark' : 'success')}">${i18nText('ui.errorsWarnings', locale, health)}</span>
          ${patchFile ? `<a href="${escapeHtml(patchFile)}" class="btn btn-sm btn-outline-dark" data-i18n="ui.patchProposals">${i18nText('ui.patchProposals', locale)}</a>` : ''}
        </div>
      </div>
      ${renderMetricTiles(systemMetrics)}
      <div class="row g-3">
        <div class="col-lg-7">
          <h6 class="mb-3" data-i18n="ui.systemDecisions">${i18nText('ui.systemDecisions', locale)}</h6>
          ${renderDecisionCards(reviewModel.systemDecisions, locale)}
        </div>
        <div class="col-lg-5">
          <h6 class="mb-3" data-i18n="ui.validationHealth">${i18nText('ui.validationHealth', locale)}</h6>
          ${renderDiagnostics(reviewModel.diagnostics.slice(0, 8), locale)}
        </div>
      </div>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(systemName)} — ${i18nText('ui.designReview', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    body { background: #f5f6f8; }
    .bc-card { transition: transform .15s, box-shadow .15s; }
    .bc-card:hover { transform: translateY(-3px); box-shadow: 0 6px 16px rgba(0,0,0,.12); }
    .bg-purple { background-color: #6f42c1 !important; }
    .metric-tile, .decision-card { background: #fff; border: 1px solid #dde2e8; border-radius: .5rem; padding: 1rem; }
    .metric-value { font-size: 1.45rem; font-weight: 700; line-height: 1; }
    .metric-label { font-size: .8rem; color: #56606b; margin-top: .35rem; }
    .metric-detail { font-size: .72rem; color: #7a8490; margin-top: .2rem; }
    .decision-card { margin-bottom: 1rem; }
    .decision-id { font-size: .72rem; color: #65717e; text-transform: uppercase; letter-spacing: .04em; }
    .option-row { display: flex; flex-wrap: wrap; gap: .35rem; }
    .prompt-box { background: #111827; color: #e5e7eb; border-radius: .4rem; padding: .9rem; margin-top: .5rem; white-space: pre-wrap; font-size: .78rem; }
    .diagnostic-list code { white-space: normal; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold fs-5">${escapeHtml(systemName)} — <span data-i18n="ui.designReview">${i18nText('ui.designReview', locale)}</span></span>
      <div class="d-flex gap-3 align-items-center"><span class="text-muted small">${escapeHtml(generatedAt)}</span>${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <div class="container-xl pb-5">
    ${descAlert}
    ${reviewIntro}
    ${diagramSection}

    <section>
      <h5 class="mb-3">
        <span data-i18n="ui.boundedContexts">${i18nText('ui.boundedContexts', locale)}</span>
        <span class="badge bg-secondary ms-1">${bcCards.length}</span>
      </h5>
      <div class="row g-3">${cards}</div>
    </section>
  </div>

  <script>mermaid.initialize({ startOnLoad: true, theme: 'default' });<\/script>
  ${clientI18nScript(locale)}
</body>
</html>`;
}

function buildOpenApiHtml(bcName, spec, locale = 'es') {
  const derefSpec = dereferenceSpec(spec);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(bcName)} — REST API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    .topbar { display: none; }
    .back-bar { background: #1b1b1b; color: #ccc; padding: 8px 20px; font-size: 13px; }
    .back-bar a { color: #90caf9; text-decoration: none; }
    .back-bar a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="back-bar">
    <a href="index.html">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a> &nbsp;/&nbsp; ${escapeHtml(bcName)} — <span data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</span> ${localeSwitcher(locale)}
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"><\/script>
  ${clientI18nScript(locale)}
  <script>
    SwaggerUIBundle({
      spec: ${safeJson(derefSpec)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: false,
      validatorUrl: null,
    });
  <\/script>
</body>
</html>`;
}

function buildAsyncApiHtml(bcName, spec, locale = 'es') {
  const channels = spec.channels || {};
  const messages = (spec.components || {}).messages || {};
  const schemas = (spec.components || {}).schemas || {};
  const info = spec.info || {};

  const channelCount = Object.keys(channels).length;
  const channelCards = Object.entries(channels)
    .map(([name, def]) => buildChannelCard(name, def, messages, schemas, locale))
    .join('');

  const infoDesc = info.description
    ? `<span class="text-muted small ms-2">${escapeHtml(info.description)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcName)} — ${i18nText('nav.events', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #f5f6f8; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark mb-4" style="background:#1a1a2e">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold">${escapeHtml(bcName)} — <span data-i18n="nav.events">${i18nText('nav.events', locale)}</span></span>
      <div class="d-flex gap-2 align-items-center"><a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <div class="container-xl pb-5">
    <div class="alert alert-dark d-flex align-items-center gap-3 mb-4">
      <div>
        <strong>${escapeHtml(info.title || bcName)}</strong>
        <span class="badge bg-secondary ms-2">v${escapeHtml(String(info.version || ''))}</span>
      </div>
      ${infoDesc}
    </div>

    <div class="d-flex align-items-center gap-3 mb-3">
      <h5 class="mb-0">
        <span data-i18n="async.channels">${i18nText('async.channels', locale)}</span>
        <span class="badge bg-secondary ms-1">${channelCount}</span>
      </h5>
      <span class="badge bg-success">&#11014; <span data-i18n="async.publish">${i18nText('async.publish', locale)}</span></span>
      <span class="badge bg-primary">&#11015; <span data-i18n="async.subscribe">${i18nText('async.subscribe', locale)}</span></span>
    </div>

    ${channelCards}
  </div>
  ${clientI18nScript(locale)}
</body>
</html>`;
}

// ─── Command registration ─────────────────────────────────────────────────────

function registerPreview(program) {
  program
    .command('preview [arch-path]')
    .description('Generate visual review of design artifacts and open in browser')
    .option('--bc <name>', 'Preview only the specified bounded context')
    .option('--no-open', 'Do not open the generated review in the browser')
    .option('--output-dir <path>', 'Directory where review files are generated')
    .option('--include-patches', 'Generate patch proposal YAML for agent iteration', true)
    .option('--no-include-patches', 'Do not generate patch proposal YAML')
    .option('--format <format>', 'Output format: html, json, or all', 'html')
    .option('--locale <lang>', 'UI language: es or en', 'es')
    .option('--strict', 'Exit with code 1 when validation errors are found')
    .action(async (archPathArg, opts) => {
      const requestedLocale = String(opts.locale || 'es').toLowerCase();
      const locale = normalizeLocale(requestedLocale);
      if (requestedLocale !== locale) {
        console.warn(chalk.yellow(`  ${t(locale, 'cli.invalidLocale', { locale: opts.locale })}`));
      }
      const archPath = archPathArg
        ? path.resolve(archPathArg)
        : path.join(process.cwd(), 'arch');

      if (!(await fs.pathExists(archPath))) {
        console.error(chalk.red(`  ${t(locale, 'cli.archNotFound', { path: archPath })}`));
        process.exit(1);
      }

      const spinner = ora(t(locale, 'cli.reading')).start();

      // system.yaml (optional)
      let systemData = null;
      const systemYamlPath = path.join(archPath, 'system', 'system.yaml');
      if (await fs.pathExists(systemYamlPath)) {
        systemData = yaml.load(await fs.readFile(systemYamlPath, 'utf8'));
      }

      // system-diagram.mmd (optional)
      let systemDiagram = null;
      const diagramPath = path.join(archPath, 'system', 'system-diagram.mmd');
      if (await fs.pathExists(diagramPath)) {
        systemDiagram = await fs.readFile(diagramPath, 'utf8');
      }

      // BC list: from system.yaml or by scanning directories
      let bcDefinitions = [];
      if (systemData?.boundedContexts?.length) {
        bcDefinitions = systemData.boundedContexts;
      } else {
        const entries = await fs.readdir(archPath);
        for (const entry of entries) {
          if (['system', 'review'].includes(entry)) continue;
          const stat = await fs.stat(path.join(archPath, entry));
          if (stat.isDirectory()) {
            bcDefinitions.push({ name: entry, type: '', purpose: '', aggregates: [] });
          }
        }
      }

      if (opts.bc) {
        bcDefinitions = bcDefinitions.filter((bc) => bc.name === opts.bc);
        if (bcDefinitions.length === 0) {
          spinner.fail(chalk.red(t(locale, 'cli.bcNotFound', { bc: opts.bc, path: archPath })));
          process.exit(1);
        }
      }

      const reviewDir = opts.outputDir ? path.resolve(opts.outputDir) : path.join(archPath, 'review');
      await fs.ensureDir(reviewDir);

      const bcArtifacts = new Map();
      const bcYamls = [];
      const asyncApiByBc = new Map();
      const openApiByBc = new Map();
      const internalApiByBc = new Map();

      for (const bc of bcDefinitions) {
        const bcName = bc.name;
        const bcDir = path.join(archPath, bcName);
        const bcYamlPath = path.join(bcDir, `${bcName}.yaml`);
        const bcDoc = await readYamlIfExists(bcYamlPath);
        const openApiDoc = await readYamlIfExists(path.join(bcDir, `${bcName}-open-api.yaml`));
        const internalApiDoc = await readYamlIfExists(path.join(bcDir, `${bcName}-internal-api.yaml`));
        const asyncApiDoc = await readYamlIfExists(path.join(bcDir, `${bcName}-async-api.yaml`));

        if (bcDoc) {
          bcDoc.bc = bcDoc.bc || bcName;
          bcYamls.push(bcDoc);
          if (openApiDoc) openApiByBc.set(bcName, openApiDoc);
          if (internalApiDoc) internalApiByBc.set(bcName, internalApiDoc);
          if (asyncApiDoc) asyncApiByBc.set(bcName, asyncApiDoc);
        }

        bcArtifacts.set(bcName, { bcDir, bcDoc, openApiDoc, internalApiDoc, asyncApiDoc });
      }

      spinner.text = t(locale, 'cli.validating');
      const diagnostics = [];
      const systemActors = new Set(
        asArray(systemData && systemData.actors)
          .map((actor) => actor && (actor.id || actor.name))
          .filter(Boolean)
      );
      for (const bcYaml of bcYamls) {
        diagnostics.push(...validateBcYamlAnatomy(bcYaml, {
          systemActors: systemActors.size > 0 ? systemActors : null,
        }));
      }
      if (systemData) {
        diagnostics.push(...validateIntegrationCoherence(systemData, bcYamls, archPath, asyncApiByBc));
      }
      for (const bcYaml of bcYamls) {
        diagnostics.push(...validateOpenApiUseCases(
          bcYaml,
          openApiByBc.get(bcYaml.bc) || null,
          internalApiByBc.get(bcYaml.bc) || null,
        ));
      }

      // Generate viewer files per BC
      spinner.text = t(locale, 'cli.generating');
      const bcCards = [];
      const reviewBcs = [];

      for (const bc of bcDefinitions) {
        const bcName = bc.name;
        const artifact = bcArtifacts.get(bcName);
        const bcDir = artifact.bcDir;
        const hasDesign = Boolean(artifact.bcDoc);
        let openApiFile = null;
        let internalApiFile = null;
        let asyncApiFile = null;
        let designFile = null;
        let reviewFile = null;

        if (hasDesign) {
          if (artifact.openApiDoc) {
            openApiFile = `${bcName}-openapi.html`;
            await fs.writeFile(path.join(reviewDir, openApiFile), buildOpenApiHtml(bcName, artifact.openApiDoc, locale), 'utf8');
          }

          if (artifact.internalApiDoc) {
            internalApiFile = `${bcName}-internal-openapi.html`;
            await fs.writeFile(path.join(reviewDir, internalApiFile), buildOpenApiHtml(`${bcName} — Internal API`, artifact.internalApiDoc, locale), 'utf8');
          }

          if (artifact.asyncApiDoc) {
            asyncApiFile = `${bcName}-asyncapi.html`;
            await fs.writeFile(path.join(reviewDir, asyncApiFile), buildAsyncApiHtml(bcName, artifact.asyncApiDoc, locale), 'utf8');
          }

          const diagramGroups = await classifyDiagrams(bcDir, bcName);
          const designHtml = buildDesignHtml(bcName, diagramGroups, openApiFile, asyncApiFile, locale);
          if (designHtml) {
            designFile = `${bcName}-design.html`;
            await fs.writeFile(path.join(reviewDir, designFile), designHtml, 'utf8');
          }

          reviewFile = `${bcName}-review.html`;
        }

        const bcDiagnostics = diagnosticsForOwner(diagnostics, bcName);
        const bcDecisions = extractBcDecisions(artifact.bcDoc, {
          openApi: artifact.openApiDoc,
          internalApi: artifact.internalApiDoc,
          asyncApi: artifact.asyncApiDoc,
        });
        const bcReview = {
          name: bcName,
          type: artifact.bcDoc?.type || bc.type,
          purpose: artifact.bcDoc?.description || bc.purpose || '',
          hasDesign,
          metrics: buildBcMetrics(artifact.bcDoc, bcDiagnostics),
          decisions: bcDecisions,
          diagnostics: bcDiagnostics,
          links: { reviewFile, designFile, openApiFile, internalApiFile, asyncApiFile },
        };
        reviewBcs.push(bcReview);

        if (reviewFile) {
          await fs.writeFile(path.join(reviewDir, reviewFile), buildBcReviewHtml(bcReview, new Date().toLocaleString(), locale), 'utf8');
        }

        bcCards.push({
          name: bcName,
          type: bc.type,
          purpose: bc.purpose,
          aggregates: bc.aggregates,
          hasDesign,
          reviewFile,
          openApiFile,
          asyncApiFile,
          designFile,
        });
      }

      const systemDecisions = extractSystemDecisions(systemData);
      const reviewModel = {
        generatedAt: new Date().toISOString(),
        archPath,
        system: systemData ? systemData.system : null,
        systemDecisions,
        boundedContexts: reviewBcs,
        decisions: [...systemDecisions, ...reviewBcs.flatMap((bc) => bc.decisions)],
        diagnostics,
      };

      let patchFile = null;
      if (opts.includePatches) {
        patchFile = 'patch-proposals.yaml';
        await fs.writeFile(path.join(reviewDir, patchFile), yaml.dump({ proposals: buildPatchProposals(reviewModel) }, { lineWidth: 120 }), 'utf8');
      }

      if (opts.format === 'json' || opts.format === 'all') {
        await fs.writeFile(path.join(reviewDir, 'review-model.json'), JSON.stringify(reviewModel, null, 2), 'utf8');
      } else if (opts.format !== 'html') {
        spinner.fail(chalk.red(t(locale, 'cli.unsupportedFormat', { format: opts.format })));
        process.exit(1);
      }

      // Generate index.html
      const generatedAt = new Date().toLocaleString();
      const indexHtml = buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt, reviewModel, patchFile, locale);
      const indexPath = path.join(reviewDir, 'index.html');
      await fs.writeFile(indexPath, indexHtml, 'utf8');

      spinner.succeed(chalk.green(t(locale, 'cli.generated', { path: reviewDir })));

      const diagnosticSummary = countDiagnostics(diagnostics);
      if (diagnosticSummary.total > 0) {
        console.log(chalk.yellow(`  ${t(locale, 'cli.diagnostics', { errors: diagnosticSummary.errors, warnings: diagnosticSummary.warnings })}`));
      }

      if (opts.strict && diagnosticSummary.errors > 0) {
        process.exitCode = 1;
      }

      if (opts.open) {
        try {
          await open(indexPath);
          console.log(chalk.blue(`  ${t(locale, 'cli.opened')}`));
        } catch {
          console.log(chalk.yellow(`  ${t(locale, 'cli.openFailed')}`));
          console.log(chalk.white(`  ${t(locale, 'cli.openManual', { path: indexPath })}`));
        }
      } else {
        console.log(chalk.white(`  ${t(locale, 'cli.openManual', { path: indexPath })}`));
      }
    });
}

module.exports = { registerPreview };
