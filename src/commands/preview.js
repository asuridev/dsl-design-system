'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const yaml = require('js-yaml');
const open = require('open');
const { validateBcYamlAnatomy } = require('../utils/bc-yaml-validator');
const { validateIntegrationCoherence, validateOpenApiUseCases } = require('@dsl/contract');
const { clientI18nScript, localeSwitcher, normalizeLocale, t, themeBootScript, themeSwitcher, clientThemeScript } = require('../utils/i18n');
const { parseBcNarrative, extractFlowScenarios } = require('../utils/narrative');

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

// Stable, HTML-id / anchor-safe slug used to cross-link entities (use cases,
// rules, errors, events, sagas) within and across review pages.
function slug(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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

async function readTextIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  return fs.readFile(filePath, 'utf8');
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
      (() => {
        const buckets = asArray(infrastructure.objectStorage);
        const bucketSummary = buckets.length
          ? `, objectStorage=${buckets.length} bucket(s) (${buckets.map((b) => `${b.name}: ${b.visibility || '?'}/${b.urlAccess || '?'}`).join(', ')})`
          : ', objectStorage=none';
        return `deployment=${infrastructure.deployment?.strategy || infrastructure.deploymentStrategy || 'default'}, database=${infrastructure.database?.type || infrastructure.databaseType || 'default'}, authServer=${String(Boolean(infrastructure.authServer))}, messageBroker=${String(Boolean(infrastructure.messageBroker))}${bucketSummary}`;
      })(),
      ['modular-monolith', 'microservices', 'schema-per-bc', 'db-per-bc', 'auth server on/off', 'message broker on/off', 'object storage on/off'],
      'Infrastructure flags explain why generated projects need shared auth, broker, or object storage capabilities.',
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
    decision(
      'SYS-006',
      'system',
      'Reliability patterns',
      'strategic',
      `outbox=${Boolean(infrastructure.reliability?.outbox)} (retention ${infrastructure.reliability?.outboxRetentionDays ?? '∞'}d), consumerIdempotency=${Boolean(infrastructure.reliability?.consumerIdempotency)} (retention ${infrastructure.reliability?.processedEventRetentionDays ?? '∞'}d)`,
      ['outbox on/off', 'consumerIdempotency on/off', 'set retention days'],
      'Event reliability flags control at-least-once publication and consumer deduplication; recommended on whenever sagas exist.',
      files
    ),
  ];
}

function extractBcDecisions(bcYaml, contracts, integrations) {
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
      integrations
        ? summarizeIntegrationStrategies(integrations)
        : `${outbound.length} outbound integration(s), ${inbound.length} inbound integration(s)`,
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

// ─── Detail extractors (semantic content, not just counts) ────────────────────
// These surface the actual design decisions (use cases, endpoint protection,
// saga flow, events) so a designer can review and refine them in-session,
// instead of inferring intent from aggregate metrics.

// Map operationId -> { method, path, summary } from an OpenAPI document so a use
// case trigger.operationId can be resolved to its real HTTP endpoint.
function indexOpenApiOperations(openApiDoc) {
  const index = new Map();
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const [routePath, pathItem] of Object.entries((openApiDoc && openApiDoc.paths) || {})) {
    for (const method of Object.keys(pathItem || {})) {
      if (!methods.includes(method)) continue;
      const op = pathItem[method] || {};
      if (op.operationId) {
        index.set(op.operationId, {
          method: method.toUpperCase(),
          path: routePath,
          summary: op.summary || '',
        });
      }
    }
  }
  return index;
}

function useCaseTriggerLabel(uc, opIndex, internalIndex) {
  const trigger = (uc && uc.trigger) || {};
  if (trigger.kind === 'http') {
    const op = (opIndex && opIndex.get(trigger.operationId))
      || (internalIndex && internalIndex.get(trigger.operationId));
    if (op) return `${op.method} ${op.path}`;
    return trigger.operationId ? `HTTP ${trigger.operationId}` : 'HTTP';
  }
  if (trigger.kind === 'event') {
    const eventName = trigger.consumes || trigger.event || 'event';
    const meta = [trigger.fromBc, trigger.channel].filter(Boolean).join(' · ');
    return meta ? `⇠ ${eventName} (${meta})` : `⇠ ${eventName}`;
  }
  return trigger.kind || '—';
}

// Index every domainRule declared across a BC's aggregates (and their entities)
// by its id, so a use case's `rules: [ID, ...]` can be resolved to what the rule
// actually says (description, type, owning aggregate, error code).
function extractDomainRuleIndex(bcYaml) {
  const index = new Map();
  for (const aggregate of asArray(bcYaml && bcYaml.aggregates)) {
    if (!aggregate) continue;
    const owners = [{ name: aggregate.name, rules: aggregate.domainRules }];
    for (const entity of asArray(aggregate.entities)) {
      if (entity && asArray(entity.domainRules).length) owners.push({ name: entity.name, rules: entity.domainRules });
    }
    for (const owner of owners) {
      for (const rule of asArray(owner.rules)) {
        if (rule && rule.id && !index.has(rule.id)) {
          index.set(rule.id, {
            id: rule.id,
            description: (rule.description || '').replace(/\s+/g, ' ').trim(),
            type: rule.type || '',
            errorCode: rule.errorCode || '',
            aggregate: owner.name || '',
          });
        }
      }
    }
  }
  return index;
}

function extractUseCaseCatalog(bcYaml, opIndex, internalIndex, narrative) {
  if (!bcYaml) return [];
  const ruleIndex = extractDomainRuleIndex(bcYaml);
  return asArray(bcYaml.useCases).map((uc) => {
    const target = [uc.aggregate, uc.method].filter(Boolean).join('.')
      || asArray(uc.aggregates).join(', ') || '—';
    const saga = uc.sagaStep
      ? { saga: uc.sagaStep.saga, order: uc.sagaStep.order, role: uc.sagaStep.role }
      : null;
    const rules = asArray(uc.rules);
    // Plain-language narrative (spec section + Given/When/Then flows) parsed
    // from {bc}-spec.md / {bc}-flows.md, resolved by use case id.
    const narr = (narrative && uc.id) ? narrative.get(uc.id) : null;
    return {
      id: uc.id || '',
      name: uc.name || '',
      actor: uc.actor || '',
      type: uc.type || '',
      description: typeof uc.description === 'string' ? uc.description : '',
      triggerKind: (uc.trigger && uc.trigger.kind) || '',
      triggerLabel: useCaseTriggerLabel(uc, opIndex, internalIndex),
      target,
      rules,
      // Resolved rule metadata for hover tooltips; `found: false` flags a
      // dangling reference (rule id not declared in any aggregate's domainRules).
      ruleDetails: rules.map((id) => ruleIndex.get(id) || { id, found: false }),
      returns: typeof uc.returns === 'string' ? uc.returns : '',
      saga,
      implementation: uc.implementation || '',
      // Lightweight operational flags used for compact badges in the catalog.
      idempotent: Boolean(uc.idempotency),
      cacheable: Boolean(uc.cacheable),
      async: Boolean(uc.async),
      bulk: Boolean(uc.bulk),
      storageCalls: asArray(uc.storageCalls).map((c) => `${c.store}:${c.operation}`),
      narrative: narr ? { spec: narr.spec || null, flows: asArray(narr.flows) } : null,
    };
  });
}

// Cross-reference index relating use cases, domain rules, events and saga steps.
// Surfaced in review-model.json so the relationships the HTML links express are
// inspectable and testable, and consumable by downstream tooling/agents.
function buildTraceabilityIndex(reviewBcs, sagas) {
  const useCases = {};
  const events = {};
  const sagaIndex = {};
  for (const bc of asArray(reviewBcs)) {
    for (const uc of asArray(bc.useCaseCatalog)) {
      if (!uc.id) continue;
      useCases[uc.id] = {
        bc: bc.name,
        rules: asArray(uc.rules),
        saga: uc.saga ? { name: uc.saga.saga, order: uc.saga.order } : null,
        anchor: `${bc.links && bc.links.reviewFile ? bc.links.reviewFile : bc.name + '-review.html'}#uc-${slug(uc.id)}`,
      };
    }
    for (const ev of asArray(bc.events && bc.events.published)) {
      events[ev.name] = {
        producer: bc.name,
        channel: ev.channel || '',
        anchor: `${bc.name}-review.html#event-${slug(ev.name)}`,
      };
    }
  }
  for (const saga of asArray(sagas)) {
    sagaIndex[saga.name] = {
      trigger: saga.trigger || null,
      steps: asArray(saga.steps).map((s) => ({
        order: s.order,
        bc: s.bc,
        implementedBy: s.implementedBy ? `${s.implementedBy.bc}/${s.implementedBy.id}` : null,
      })),
    };
  }
  return { useCases, events, sagas: sagaIndex };
}

// Operational / non-functional decisions declared per use case (idempotency,
// caching, async execution, bulk, pagination, implementation completeness and
// outbound dependencies). These determine critical runtime behavior in the
// generated project but were previously invisible in the preview.
function extractOperationsMatrix(bcYaml, opIndex, internalIndex) {
  if (!bcYaml) return [];
  return asArray(bcYaml.useCases).map((uc) => {
    const idempotency = uc.idempotency
      ? { header: uc.idempotency.header || 'Idempotency-Key', ttl: uc.idempotency.ttl || '' }
      : null;
    const cache = uc.cacheable
      ? { ttl: uc.cacheable.ttl || '', keyFields: asArray(uc.cacheable.keyFields) }
      : null;
    const async = uc.async
      ? { mode: uc.async.mode || '', statusEndpoint: uc.async.statusEndpoint || '' }
      : null;
    const bulk = uc.bulk
      ? { maxItems: uc.bulk.maxItems != null ? uc.bulk.maxItems : '', onItemError: uc.bulk.onItemError || '' }
      : null;
    const pagination = uc.pagination
      ? {
        defaultSize: uc.pagination.defaultSize != null ? uc.pagination.defaultSize : '',
        maxSize: uc.pagination.maxSize != null ? uc.pagination.maxSize : '',
        sort: uc.pagination.defaultSort
          ? `${uc.pagination.defaultSort.field || ''} ${uc.pagination.defaultSort.direction || ''}`.trim()
          : '',
      }
      : null;
    const outgoing = asArray(uc.outgoingCalls);
    const fk = asArray(uc.fkValidations);
    const lookups = asArray(uc.lookups);
    const detail = [
      ...outgoing.map((c) => `→ ${c && c.port ? c.port + '.' + (c.method || '') : 'outgoingCall'}`),
      ...fk.map((c) => `fk ${(c && (c.aggregate || c.field)) || '?'}`),
      ...lookups.map((l) => `lookup ${(l && (l.aggregate || l.param)) || '?'}`),
    ];
    return {
      id: uc.id || '',
      name: uc.name || '',
      type: uc.type || '',
      triggerKind: (uc.trigger && uc.trigger.kind) || '',
      endpoint: useCaseTriggerLabel(uc, opIndex, internalIndex),
      idempotency,
      cache,
      async,
      bulk,
      pagination,
      implementation: uc.implementation || 'full',
      deps: { outgoing: outgoing.length, fk: fk.length, lookups: lookups.length, detail },
    };
  });
}

function extractSecurityMatrix(bcYaml, opIndex, internalIndex) {
  if (!bcYaml) return [];
  return asArray(bcYaml.useCases)
    .filter((uc) => uc && uc.trigger && uc.trigger.kind === 'http')
    .map((uc) => {
      const auth = uc.authorization || {};
      const ownership = auth.ownership
        ? { field: auth.ownership.field || '', claim: auth.ownership.claim || '' }
        : null;
      const roles = asArray(auth.rolesAnyOf);
      const permissions = asArray(auth.permissionsAnyOf);
      const scopes = asArray(auth.scopesAnyOf);
      const isPublic = uc.public === true;
      const hasAuth = Boolean(roles.length || permissions.length || scopes.length || ownership);
      return {
        id: uc.id || '',
        name: uc.name || '',
        endpoint: useCaseTriggerLabel(uc, opIndex, internalIndex),
        public: isPublic,
        roles,
        permissions,
        scopes,
        ownership,
        unprotected: !isPublic && !hasAuth,
      };
    });
}

// Build a deterministic Mermaid sequenceDiagram for a saga: trigger event,
// ordered cross-BC steps (labeled with the triggering event + implementing UC),
// and failure/compensation notes.
function buildSagaMermaid(saga, steps) {
  const idFor = (name) => 'bc_' + String(name || 'unknown').replace(/[^A-Za-z0-9]/g, '_');
  const clean = (text) => String(text || '').replace(/[\r\n]+/g, ' ').replace(/[;#]/g, ' ').trim();
  const participants = [];
  const addP = (bc) => { if (bc && !participants.includes(bc)) participants.push(bc); };
  addP(saga.trigger && saga.trigger.bc);
  for (const step of steps) addP(step.bc);

  const lines = ['sequenceDiagram', '  autonumber'];
  for (const bc of participants) lines.push(`  participant ${idFor(bc)} as ${clean(bc)}`);

  const triggerBc = (saga.trigger && saga.trigger.bc) || (steps[0] && steps[0].bc) || participants[0];
  if (saga.trigger && saga.trigger.event) {
    lines.push(`  Note over ${idFor(triggerBc)}: trigger: ${clean(saga.trigger.event)}`);
  }

  let prev = triggerBc;
  for (const step of steps) {
    const impl = step.implementedBy ? ` [${step.implementedBy.id} ${step.implementedBy.name}]` : '';
    const label = clean(`${step.order != null ? step.order + '. ' : ''}${step.triggeredBy}${impl}`);
    lines.push(`  ${idFor(prev)}->>${idFor(step.bc)}: ${label || 'step'}`);
    const notes = [];
    if (step.onFailure) notes.push(`onFailure: ${step.onFailure}`);
    if (step.compensation) notes.push(`compensacion: ${step.compensation}`);
    if (notes.length) lines.push(`  Note over ${idFor(step.bc)}: ${clean(notes.join(' / '))}`);
    prev = step.bc;
  }

  const last = steps[steps.length - 1];
  if (last && last.onSuccess) {
    lines.push(`  Note over ${idFor(last.bc)}: ✓ ${clean(last.onSuccess)}`);
  }
  return sanitizeMermaidSource(lines.join('\n'));
}

function extractSagas(systemData, bcYamls) {
  const sagas = asArray(systemData && systemData.sagas);
  // Resolve which use case implements each saga step via uc.sagaStep.
  const stepImpl = new Map();
  for (const bcYaml of asArray(bcYamls)) {
    for (const uc of asArray(bcYaml.useCases)) {
      const ss = uc && uc.sagaStep;
      if (ss && ss.saga != null && ss.order != null) {
        stepImpl.set(`${ss.saga}#${ss.order}`, { bc: bcYaml.bc, id: uc.id || '', name: uc.name || '' });
      }
    }
  }
  return sagas.map((saga) => {
    const steps = asArray(saga.steps).map((step) => ({
      order: step.order,
      bc: step.bc || '',
      triggeredBy: step.triggeredBy || '',
      onSuccess: step.onSuccess || '',
      onFailure: step.onFailure || '',
      compensation: step.compensation || '',
      implementedBy: stepImpl.get(`${saga.name}#${step.order}`) || null,
    }));
    return {
      name: saga.name || '',
      description: saga.description || '',
      trigger: { event: (saga.trigger && saga.trigger.event) || '', bc: (saga.trigger && saga.trigger.bc) || '' },
      steps,
      mermaid: buildSagaMermaid(saga, steps),
    };
  });
}

function summarizePayload(payload) {
  return asArray(payload).map((field) => `${field.name}: ${field.type || '—'}`);
}

function extractEvents(bcYaml) {
  if (!bcYaml) return { published: [], consumed: [], readModels: [] };
  const domainEvents = bcYaml.domainEvents || {};
  const published = asArray(domainEvents.published).map((event) => ({
    name: event.name || '',
    channel: event.channel || '',
    scope: event.scope || '',
    payload: summarizePayload(event.payload),
  }));
  const consumed = asArray(domainEvents.consumed).map((event) => ({
    name: event.name || '',
    // Canonical YAML uses `from`; accept `sourceBc` for backward compatibility.
    sourceBc: event.from || event.sourceBc || '',
    channel: event.channel || '',
  }));
  const readModels = [
    ...asArray(bcYaml.projections).filter((p) => p && p.persistent === true).map((p) => ({
      name: p.name || '',
      event: (p.source && p.source.event) || '',
      from: (p.source && p.source.from) || '',
      keyBy: p.keyBy || '',
      upsertStrategy: p.upsertStrategy || '',
    })),
    ...asArray(bcYaml.aggregates).filter((a) => a && a.readModel === true).map((a) => ({
      name: a.name || '', event: '', from: '', keyBy: '', upsertStrategy: '',
    })),
  ];
  return { published, consumed, readModels };
}

function extractStorageUsage(bcYaml, systemData) {
  if (!bcYaml) return [];
  const storageIndex = Object.fromEntries(
    asArray(systemData && systemData.infrastructure && systemData.infrastructure.objectStorage)
      .map((s) => [s.name, s])
  );
  const byStore = {};
  for (const uc of asArray(bcYaml.useCases)) {
    for (const call of asArray(uc.storageCalls)) {
      if (!call || !call.store) continue;
      if (!byStore[call.store]) {
        const decl = storageIndex[call.store] || {};
        byStore[call.store] = {
          store: call.store,
          visibility: decl.visibility || '—',
          urlAccess: decl.urlAccess || '—',
          ownedBy: decl.ownedBy || '—',
          signedUrlTtl: decl.signedUrlTtl || null,
          notes: decl.notes || '',
          usages: [],
        };
      }
      byStore[call.store].usages.push({
        ucId: uc.id || '—',
        ucName: uc.name || '—',
        operation: call.operation || '—',
        input: call.input || null,
        bindsTo: call.bindsTo || null,
      });
    }
  }
  return Object.values(byStore);
}

// ─── Integrations (direct bounded-context relationships) ──────────────────────
// Merge the tactical view (bcYaml.integrations.outbound/inbound) with the
// strategic context map (system.integrations) so a designer can see, per BC,
// what it depends on, who depends on it, with which DDD strategy and channel,
// and — crucially — the rationale (necessity) behind each integration.

// Normalize an integration pattern (tactical camelCase or strategic kebab-case)
// to a canonical label plus a Bootstrap badge class.
function normalizeIntegrationPattern(raw) {
  const key = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  const map = {
    customersupplier: { label: 'customer-supplier', badge: 'primary' },
    event: { label: 'event', badge: 'info text-dark' },
    acl: { label: 'acl', badge: 'danger' },
    sharedkernel: { label: 'shared-kernel', badge: 'warning text-dark' },
    openhost: { label: 'open-host', badge: 'success' },
    conformist: { label: 'conformist', badge: 'secondary' },
    partnership: { label: 'partnership', badge: 'dark' },
  };
  return map[key] || { label: raw ? String(raw) : '—', badge: 'secondary' };
}

function summarizeResilience(resilience) {
  if (!resilience || typeof resilience !== 'object') return '';
  const parts = [];
  if (resilience.timeoutMs != null) parts.push(`timeout ${resilience.timeoutMs}ms`);
  if (resilience.retries && resilience.retries.maxAttempts != null) parts.push(`retries ${resilience.retries.maxAttempts}`);
  if (resilience.circuitBreaker && resilience.circuitBreaker.failureRateThreshold != null) {
    parts.push(`CB ${resilience.circuitBreaker.failureRateThreshold}%`);
  }
  return parts.join(' · ');
}

function extractIntegrations(bcYaml, systemData) {
  const result = { outbound: [], inbound: [], contextMap: '' };
  const bcName = bcYaml && bcYaml.bc;
  if (!bcName) return result;

  const index = new Map();
  const ensure = (direction, partner) => {
    const key = `${direction}|${partner}`;
    let entry = index.get(key);
    if (!entry) {
      entry = {
        direction,
        partner: partner || '—',
        partnerType: '',
        patternLabel: '',
        badge: 'secondary',
        channel: '',
        contracts: [],
        triggers: [],
        auth: '',
        resilience: '',
        rationaleParts: [],
      };
      index.set(key, entry);
      result[direction].push(entry);
    }
    return entry;
  };
  const addContracts = (entry, contracts) => {
    for (const c of contracts) {
      if (c && !entry.contracts.includes(c)) entry.contracts.push(c);
    }
  };
  const setPattern = (entry, raw) => {
    if (!raw) return;
    const norm = normalizeIntegrationPattern(raw);
    entry.patternLabel = norm.label;
    entry.badge = norm.badge;
  };
  const addRationale = (entry, text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean && !entry.rationaleParts.includes(clean)) entry.rationaleParts.push(clean);
  };

  // 1. Tactical integrations declared in the BC YAML.
  const tactical = (bcYaml.integrations && typeof bcYaml.integrations === 'object') ? bcYaml.integrations : {};
  for (const direction of ['outbound', 'inbound']) {
    for (const item of asArray(tactical[direction])) {
      if (!item) continue;
      const entry = ensure(direction, item.name || '');
      if (item.type) entry.partnerType = item.type;
      setPattern(entry, item.pattern);
      if (item.protocol && !entry.channel) entry.channel = item.protocol;
      if (item.auth && item.auth.type && !entry.auth) entry.auth = item.auth.type;
      addRationale(entry, item.description);
      const ops = asArray(item.operations);
      addContracts(entry, ops.map((op) => op && op.name).filter(Boolean));
      for (const op of ops) {
        if (op && op.triggersOn && !entry.triggers.includes(op.triggersOn)) entry.triggers.push(op.triggersOn);
      }
    }
  }

  // 2. Strategic integrations (system.integrations); from === BC is outbound,
  //    to === BC is inbound. System metadata wins over tactical for shared fields.
  for (const integ of asArray(systemData && systemData.integrations)) {
    if (!integ) continue;
    let direction = null;
    let partner = null;
    if (integ.from === bcName) { direction = 'outbound'; partner = integ.to; }
    else if (integ.to === bcName) { direction = 'inbound'; partner = integ.from; }
    if (!direction) continue;
    const entry = ensure(direction, partner || '');
    setPattern(entry, integ.pattern);
    if (integ.channel) entry.channel = integ.channel;
    if (integ.auth && integ.auth.type) entry.auth = integ.auth.type;
    const resilience = summarizeResilience(integ.resilience);
    if (resilience) entry.resilience = resilience;
    addContracts(entry, asArray(integ.contracts).map((c) => (typeof c === 'string' ? c : (c && c.name))).filter(Boolean));
    addRationale(entry, integ.notes);
  }

  for (const direction of ['outbound', 'inbound']) {
    for (const entry of result[direction]) {
      entry.rationale = entry.rationaleParts.join('\n');
      entry.missingRationale = entry.rationale.length === 0;
      delete entry.rationaleParts;
      if (!entry.patternLabel) entry.patternLabel = '—';
    }
    result[direction].sort((a, b) => a.partner.localeCompare(b.partner));
  }

  result.contextMap = buildBcContextMapMermaid(bcName, result);
  return result;
}

function summarizeIntegrationStrategies(integrations) {
  const fmt = (list) => {
    if (!list.length) return '0';
    const counts = countBy(list, (e) => `${e.patternLabel}${e.channel ? '/' + e.channel : ''}`);
    return `${list.length} (${describeCounts(counts)})`;
  };
  return `outbound: ${fmt(asArray(integrations && integrations.outbound))}; inbound: ${fmt(asArray(integrations && integrations.inbound))}`;
}

// Deterministic Mermaid flowchart placing the BC at the center, with outbound
// edges to its dependencies and inbound edges from its consumers, each labeled
// with the integration strategy and channel. External systems use a distinct shape.
function buildBcContextMapMermaid(bcName, integrations) {
  const outbound = asArray(integrations && integrations.outbound);
  const inbound = asArray(integrations && integrations.inbound);
  if (!outbound.length && !inbound.length) return '';
  const idFor = (name) => 'n_' + String(name || 'unknown').replace(/[^A-Za-z0-9]/g, '_');
  const clean = (text) => String(text || '').replace(/[\r\n]+/g, ' ').replace(/[;#|"]/g, ' ').trim();
  const center = idFor(bcName);
  const lines = ['flowchart LR', `  ${center}["${clean(bcName)}"]:::center`];
  const declared = new Set([center]);
  const declareNode = (entry) => {
    const id = idFor(entry.partner);
    if (!declared.has(id)) {
      declared.add(id);
      const isExternal = String(entry.partnerType || '').toLowerCase().includes('external');
      lines.push(isExternal
        ? `  ${id}[("${clean(entry.partner)}")]:::external`
        : `  ${id}["${clean(entry.partner)}"]`);
    }
    return id;
  };
  const edgeLabel = (entry) => clean([entry.patternLabel, entry.channel].filter((v) => v && v !== '—').join(' / ')) || 'uses';
  for (const entry of outbound) lines.push(`  ${center} -->|${edgeLabel(entry)}| ${declareNode(entry)}`);
  for (const entry of inbound) lines.push(`  ${declareNode(entry)} -->|${edgeLabel(entry)}| ${center}`);
  lines.push('  classDef center fill:#111827,color:#fff,stroke:#111827;');
  lines.push('  classDef external fill:#fff7ed,stroke:#fb923c,color:#7c2d12;');
  return sanitizeMermaidSource(lines.join('\n'));
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

  // Security gaps: HTTP endpoints with neither authorization nor a public flag.
  // Surfaced as explicit review points so the designer confirms intent in-session.
  const securityProposals = asArray(reviewModel.boundedContexts).flatMap((bc) =>
    asArray(bc.securityMatrix)
      .filter((entry) => entry.unprotected)
      .map((entry) => {
        const file = `arch/${bc.name}/${bc.name}.yaml`;
        return {
          id: `SEC-${bc.name}-${entry.id}`,
          title: `Unprotected endpoint ${entry.id} ${entry.name} (${entry.endpoint})`,
          severity: 'review',
          rationale: 'HTTP use case has no authorization and is not marked public; access control must be confirmed.',
          affectedFiles: [file],
          current: `${entry.endpoint} has no authorization and public is not set`,
          proposed: 'Decide whether this endpoint is intentionally public or requires authorization (rolesAnyOf/permissionsAnyOf/scopesAnyOf/ownership).',
          agentPrompt: buildAgentPrompt(
            `Endpoint protection for ${entry.id} ${entry.name}`,
            `${entry.endpoint} in ${bc.name} has no authorization and public is not set`,
            [file],
            'Confirm with the designer whether this endpoint should be public or protected, then set public:true or an authorization block accordingly.'
          ),
        };
      })
  );

  return [...diagnosticProposals, ...decisionProposals, ...securityProposals];
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
  const storageStores = new Set(
    useCases.flatMap((uc) => asArray(uc.storageCalls).map((c) => c && c.store).filter(Boolean))
  );

  return [
    { label: 'Aggregates', value: aggregates.length, detail: `${aggregates.reduce((sum, aggregate) => sum + asArray(aggregate && aggregate.entities).length, 0)} entities` },
    { label: 'Use cases', value: useCases.length, detail: `${useCaseTypes.command || 0} commands, ${useCaseTypes.query || 0} queries` },
    { label: 'Events', value: published.length + consumed.length, detail: `${published.length} published, ${consumed.length} consumed` },
    { label: 'Integrations', value: outbound.length + inbound.length, detail: `${outbound.length} outbound, ${inbound.length} inbound` },
    { label: 'Read models', value: readModels, detail: 'readModel aggregates + persistent projections' },
    { label: 'Storage', value: storageStores.size, detail: storageStores.size ? [...storageStores].join(', ') : 'no buckets' },
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
  ${themeBootScript()}
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    body { background: var(--bs-secondary-bg); }
    .diagram-wrap {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
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
    .diagram-toolbar { display: flex; gap: .35rem; justify-content: flex-end; flex-wrap: wrap; margin-bottom: .5rem; position: sticky; top: 0; z-index: 2; background: var(--bs-body-bg); padding-bottom: .25rem; }
    .diagram-hint { text-align: right; margin-bottom: .75rem; }
    .diag-error pre {
      background: #fff8e1; border: 1px solid #ffe082; border-radius: .4rem;
      padding: 1rem; font-size: .78rem; text-align: left; white-space: pre-wrap; margin: 0;
    }
    .diag-error .error-message { background: #fff3cd; border: 1px solid #ffecb5; border-radius: .4rem; padding: .75rem; text-align: left; margin-bottom: .75rem; }
    .line-no { color: var(--bs-secondary-color); user-select: none; display: inline-block; width: 3.5rem; }
    .prompt-box { background: #111827; color: #e5e7eb; border-radius: .4rem; padding: .9rem; margin-top: .5rem; white-space: pre-wrap; font-size: .78rem; text-align: left; }
    .diagram-title { color: var(--bs-secondary-color); font-size: .85rem; font-weight: 600; margin-bottom: .5rem; text-transform: uppercase; letter-spacing: .04em; }
    .nav-tabs .nav-link { font-size: .9rem; }
    .loading-spinner { color: #adb5bd; font-size: .85rem; padding: 2rem; }
    .diag-target svg { display: block; max-width: none; height: auto; }
    [data-bs-theme="dark"] .diag-error pre { background: #2a2410; border-color: #5c4d12; color: #e8dca6; }
    [data-bs-theme="dark"] .diag-error .error-message { background: #322a0c; border-color: #5c4d12; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(bcName)} — <span data-i18n="nav.diagrams">${i18nText('nav.diagrams', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">${apiLinks}${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
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
  ${clientThemeScript()}
  <script>
    ${diagramsJs}
    mermaid.initialize({ startOnLoad: false, theme: (window.__dslPreviewTheme === 'dark' ? 'dark' : 'default') });

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
  return decisions.map((item, idx) => {
    const promptId = `prompt-${slug(item.id || 'decision')}-${idx}`;
    const current = String(item.current || '').toLowerCase();
    // Highlight the option that matches the current decision (token appears in
    // the current-state summary) so the reviewer sees the live choice vs. the
    // alternatives at a glance.
    const options = asArray(item.options).map((option) => {
      const isCurrent = current && current.includes(String(option).toLowerCase());
      return isCurrent
        ? `<span class="badge rounded-pill text-bg-primary">${escapeHtml(option)} · <span data-i18n="ui.recommended">${i18nText('ui.recommended', locale)}</span></span>`
        : `<span class="badge rounded-pill text-bg-secondary">${escapeHtml(option)}</span>`;
    }).join('');
    return `
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
      <div class="option-row mb-3">${options}</div>
      <details>
        <summary class="small fw-semibold d-inline-flex align-items-center gap-2">
          <span data-i18n="ui.promptForAgent">${i18nText('ui.promptForAgent', locale)}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary copy-btn" data-copy-target="#${promptId}" data-i18n="ui.copyPrompt">${i18nText('ui.copyPrompt', locale)}</button>
        </summary>
        <pre class="prompt-box"><code id="${promptId}">${escapeHtml(item.prompt)}</code></pre>
      </details>
    </article>`;
  }).join('');
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

// ─── Detail renderers (use cases, security, sagas, events) ────────────────────

function pillList(items, cls = 'text-bg-secondary') {
  const arr = asArray(items);
  if (!arr.length) return '<span class="text-muted">—</span>';
  return arr.map((value) => `<span class="badge rounded-pill ${cls} me-1">${escapeHtml(value)}</span>`).join('');
}

// Render domain-rule badges with a native `title` tooltip describing what each
// rule consists of (type · description → errorCode), resolved from ruleDetails.
function rulePills(ruleDetails, locale = 'es') {
  const arr = asArray(ruleDetails);
  if (!arr.length) return '<span class="text-muted">—</span>';
  return arr.map((rule) => {
    if (rule.found === false) {
      const tip = i18nText('uc.ruleNotFound', locale);
      return `<span class="badge rounded-pill text-bg-warning me-1" title="${escapeHtml(tip)}">${escapeHtml(rule.id)} ?</span>`;
    }
    const parts = [];
    if (rule.type) parts.push(rule.type);
    if (rule.aggregate) parts.push(rule.aggregate);
    const header = parts.join(' · ');
    const tip = [header, rule.description, rule.errorCode ? `→ ${rule.errorCode}` : '']
      .filter(Boolean).join('\n');
    return `<span class="badge rounded-pill text-bg-light border me-1" title="${escapeHtml(tip)}" style="cursor:help">${escapeHtml(rule.id)}</span>`;
  }).join('');
}

function actorBadgeClass(actor) {
  return { customer: 'primary', admin: 'danger', system: 'secondary' }[actor] || 'dark';
}

function ucTypeBadgeClass(type) {
  return type === 'query' ? 'info text-dark' : 'warning text-dark';
}

// Compact operational badges shown next to a use case name in the catalog.
// Each badge is a glyph + i18n tooltip so the catalog hints at non-functional
// behavior without a full table.
function behaviorBadges(uc, locale = 'es') {
  const badges = [];
  const add = (glyph, cls, hintKey) =>
    badges.push(`<span class="badge ${cls} ms-1" title="${i18nText(hintKey, locale)}">${glyph}</span>`);
  if (uc.idempotent) add('&#10227;', 'bg-primary', 'ops.idempotentHint');
  if (uc.cacheable) add('&#9889;', 'bg-info text-dark', 'ops.cacheableHint');
  if (uc.async) add('&#9201;', 'bg-secondary', 'ops.asyncHint');
  if (uc.bulk) add('&#9636;', 'bg-dark', 'ops.bulkHint');
  if (uc.implementation === 'scaffold') {
    badges.push(`<span class="badge bg-warning text-dark ms-1" title="${i18nText('ops.scaffoldHint', locale)}">scaffold</span>`);
  }
  for (const call of asArray(uc.storageCalls)) {
    badges.push(`<span class="badge bg-secondary ms-1" title="${escapeHtml(call)}">&#128190; ${escapeHtml(call)}</span>`);
  }
  return badges.join('');
}

function mermaidScriptTag() {
  return `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>`;
}

// Renders every .mermaid block on the page (used by review / explorer pages).
function mermaidRenderAllScript() {
  return `<script>
    mermaid.initialize({ startOnLoad: false, theme: (window.__dslPreviewTheme === 'dark' ? 'dark' : 'default') });
    window.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('.mermaid').forEach(function (el) {
        try { mermaid.run({ nodes: [el], suppressErrors: true }); }
        catch (e) { console.warn('Mermaid render error:', e); }
      });
    });
  <\/script>`;
}

// Shared CSS for the restructured review experience: cards, metric tiles,
// expandable use-case narrative, copy-prompt buttons, sticky in-page nav,
// collapsible sections and the cross-link highlight. Kept inline so the output
// stays self-contained and works offline via file://.
function reviewSharedStyles() {
  return `
    body { background: var(--bs-secondary-bg); color: var(--bs-body-color); }
    [data-bs-theme="dark"] .btn-dark {
      --bs-btn-color: #212529; --bs-btn-bg: #e9ecef; --bs-btn-border-color: #e9ecef;
      --bs-btn-hover-color: #212529; --bs-btn-hover-bg: #f8f9fa; --bs-btn-hover-border-color: #f8f9fa;
      --bs-btn-active-color: #212529; --bs-btn-active-bg: #f8f9fa; --bs-btn-active-border-color: #f8f9fa;
    }
    [data-bs-theme="dark"] .btn-outline-dark {
      --bs-btn-color: #dee2e6; --bs-btn-border-color: #6c757d;
      --bs-btn-hover-color: #212529; --bs-btn-hover-bg: #dee2e6; --bs-btn-hover-border-color: #dee2e6;
      --bs-btn-active-color: #212529; --bs-btn-active-bg: #dee2e6; --bs-btn-active-border-color: #dee2e6;
    }
    .bg-purple { background-color: #6f42c1 !important; }
    .metric-tile, .decision-card, .detail-card, .saga-card { background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); border-radius: .5rem; padding: 1rem; }
    .detail-card { margin-bottom: 1.25rem; }
    .metric-value { font-size: 1.45rem; font-weight: 700; line-height: 1; }
    .metric-label { font-size: .8rem; color: var(--bs-secondary-color); margin-top: .35rem; }
    .metric-detail { font-size: .72rem; color: var(--bs-tertiary-color); margin-top: .2rem; }
    .decision-card { margin-bottom: 1rem; }
    .decision-id { font-size: .72rem; color: var(--bs-secondary-color); text-transform: uppercase; letter-spacing: .04em; }
    .option-row { display: flex; flex-wrap: wrap; gap: .35rem; }
    .prompt-box { background: #111827; color: #e5e7eb; border-radius: .4rem; padding: .9rem; margin-top: .5rem; white-space: pre-wrap; font-size: .78rem; }
    .diagnostic-list code { white-space: normal; }
    .saga-diagram { background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); border-radius: .5rem; padding: 1rem; overflow: auto; text-align: center; }
    /* Expandable use-case narrative */
    .uc-row { cursor: pointer; }
    .uc-toggle { color: var(--bs-secondary-color); text-decoration: none; }
    .uc-caret { display: inline-block; transition: transform .15s; }
    .uc-toggle[aria-expanded="true"] .uc-caret { transform: rotate(90deg); }
    .uc-detail { padding: .5rem .25rem; font-size: .9rem; }
    .uc-detail .narrative-quote { border-left: 3px solid var(--bs-border-color); padding-left: .75rem; color: var(--bs-secondary-color); margin: .5rem 0; }
    .uc-detail .narrative-code { background: var(--bs-tertiary-bg); border: 1px solid var(--bs-border-color); border-radius: .35rem; padding: .6rem; font-size: .8rem; overflow:auto; }
    .uc-detail .narrative-table { font-size: .82rem; }
    .uc-detail .narrative-flow > summary { cursor: pointer; }
    .uc-detail .narrative-subheading { text-transform: uppercase; letter-spacing: .03em; color: var(--bs-secondary-color); margin-top: .75rem; }
    /* Validation scenarios (Given/When/Then) */
    .scenario-card { background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); border-radius: .5rem; padding: .85rem 1rem; }
    .flow-seg { border-left: 3px solid var(--bs-border-color); padding: .25rem .75rem; margin: .4rem 0; }
    .flow-seg-label { display: inline-block; text-transform: uppercase; letter-spacing: .04em; font-size: .68rem; font-weight: 700; padding: .05rem .4rem; border-radius: .25rem; margin-bottom: .25rem; }
    .flow-seg-body > :last-child { margin-bottom: 0; }
    .flow-seg-body ul, .flow-seg-body ol { margin-bottom: .25rem; }
    .flow-seg--given { border-left-color: var(--bs-info); }
    .flow-seg--given .flow-seg-label { background: var(--bs-info-bg-subtle); color: var(--bs-info-text-emphasis); }
    .flow-seg--when { border-left-color: var(--bs-primary); }
    .flow-seg--when .flow-seg-label { background: var(--bs-primary-bg-subtle); color: var(--bs-primary-text-emphasis); }
    .flow-seg--then { border-left-color: var(--bs-success); }
    .flow-seg--then .flow-seg-label { background: var(--bs-success-bg-subtle); color: var(--bs-success-text-emphasis); }
    .flow-seg--edge { border-left-color: var(--bs-warning); }
    .flow-seg--edge .flow-seg-label { background: var(--bs-warning-bg-subtle); color: var(--bs-warning-text-emphasis); }
    .flow-seg--other .flow-seg-label { background: var(--bs-secondary-bg); color: var(--bs-secondary-color); }
    .flow-seg--intro { border-left-color: transparent; padding-left: 0; }
    .narrative-code, .scenario-card .narrative-code { background: var(--bs-tertiary-bg); border: 1px solid var(--bs-border-color); border-radius: .35rem; padding: .6rem; font-size: .8rem; overflow: auto; }
    /* Copy-to-clipboard control */
    .copy-btn { font-size: .72rem; }
    .copy-btn.copied { color: var(--bs-success); border-color: var(--bs-success); }
    /* Sticky in-page navigation */
    .review-nav { position: sticky; top: 1rem; font-size: .82rem; }
    .review-nav a { display: block; padding: .2rem .5rem; border-left: 2px solid transparent; color: var(--bs-secondary-color); text-decoration: none; border-radius: 0 .25rem .25rem 0; }
    .review-nav a:hover { background: var(--bs-tertiary-bg); color: var(--bs-body-color); }
    .review-nav a.active { border-left-color: var(--bs-primary); color: var(--bs-body-color); font-weight: 600; }
    /* Attention panel + cross-link target highlight */
    .attention-card { border-left: 4px solid var(--bs-warning); }
    .attention-card.is-error { border-left-color: var(--bs-danger); }
    .attention-card.is-ok { border-left-color: var(--bs-success); }
    :target { scroll-margin-top: 4.5rem; }
    .xref-flash { animation: xrefFlash 1.4s ease-out; }
    @keyframes xrefFlash { 0% { background: rgba(255,193,7,.45); } 100% { background: transparent; } }
    .collapsible-section > .section-toggle { cursor: pointer; user-select: none; }
    .collapsible-section > .section-toggle .uc-caret { transform: rotate(90deg); }
    .collapsible-section.collapsed > .section-toggle .uc-caret { transform: rotate(0deg); }
    .collapsible-section.collapsed > .section-body { display: none; }`;
}

// Shared client-side behavior for the review pages: expand/collapse use-case
// narrative rows, copy agent prompts to clipboard, collapse dense sections,
// scroll-spy for the in-page nav, and a flash highlight when following an
// in-page cross-link. Pure vanilla JS (no Bootstrap JS bundle required).
function reviewInteractionScript() {
  return `<script>
    (function () {
      // Expand / collapse use-case narrative rows.
      document.addEventListener('click', function (ev) {
        var trigger = ev.target.closest('[data-uc-toggle]');
        if (trigger) {
          if (ev.target.closest('a, button.copy-btn, summary')) return;
          var id = trigger.getAttribute('data-uc-toggle');
          var detail = document.getElementById(id);
          if (detail) {
            var open = detail.hasAttribute('hidden');
            if (open) { detail.removeAttribute('hidden'); } else { detail.setAttribute('hidden', ''); }
            document.querySelectorAll('[data-uc-toggle="' + id + '"] .uc-toggle, .uc-toggle[data-uc-toggle="' + id + '"]').forEach(function (b) {
              b.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            var btn = trigger.matches('.uc-toggle') ? trigger : trigger.querySelector('.uc-toggle');
            if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
          return;
        }
        // Copy-to-clipboard buttons.
        var copy = ev.target.closest('.copy-btn');
        if (copy) {
          ev.preventDefault();
          var sel = copy.getAttribute('data-copy-target');
          var src = sel ? document.querySelector(sel) : null;
          var text = src ? src.textContent : (copy.getAttribute('data-copy-text') || '');
          var done = function () {
            copy.classList.add('copied');
            var prev = copy.textContent;
            copy.textContent = (window.dslT ? dslT('ui.copied') : 'Copied');
            setTimeout(function () { copy.classList.remove('copied'); copy.textContent = prev; }, 1600);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done);
          } else {
            var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
            ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done();
          }
          return;
        }
        // Collapsible section headers.
        var st = ev.target.closest('.section-toggle');
        if (st) {
          var sec = st.closest('.collapsible-section');
          if (sec) sec.classList.toggle('collapsed');
        }
      });

      // Flash highlight when navigating to an in-page anchor (traceability links).
      function flashTarget() {
        if (!location.hash) return;
        var el = document.getElementById(location.hash.slice(1));
        if (!el) return;
        // If the target is a hidden narrative detail row, reveal it.
        if (el.hasAttribute && el.hasAttribute('hidden')) el.removeAttribute('hidden');
        el.classList.remove('xref-flash');
        void el.offsetWidth;
        el.classList.add('xref-flash');
      }
      window.addEventListener('hashchange', flashTarget);
      window.addEventListener('DOMContentLoaded', flashTarget);

      // Scroll-spy for the in-page nav.
      window.addEventListener('DOMContentLoaded', function () {
        var links = Array.prototype.slice.call(document.querySelectorAll('.review-nav a[href^="#"]'));
        if (!links.length || !('IntersectionObserver' in window)) return;
        var map = {};
        var targets = [];
        links.forEach(function (a) {
          var t = document.getElementById(a.getAttribute('href').slice(1));
          if (t) { map[t.id] = a; targets.push(t); }
        });
        var obs = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              links.forEach(function (a) { a.classList.remove('active'); });
              if (map[e.target.id]) map[e.target.id].classList.add('active');
            }
          });
        }, { rootMargin: '-20% 0px -70% 0px' });
        targets.forEach(function (t) { obs.observe(t); });
      });
    })();
  <\/script>`;
}

function useCaseTableHead(locale) {
  return `<thead class="table-light"><tr>
    <th style="width:1.6rem"></th>
    <th data-i18n="uc.id">${i18nText('uc.id', locale)}</th>
    <th data-i18n="uc.name">${i18nText('uc.name', locale)}</th>
    <th data-i18n="uc.actor">${i18nText('uc.actor', locale)}</th>
    <th data-i18n="uc.type">${i18nText('uc.type', locale)}</th>
    <th data-i18n="uc.trigger">${i18nText('uc.trigger', locale)}</th>
    <th data-i18n="uc.target">${i18nText('uc.target', locale)}</th>
    <th data-i18n="uc.rules">${i18nText('uc.rules', locale)}</th>
    <th data-i18n="uc.saga">${i18nText('uc.saga', locale)}</th>
  </tr></thead>`;
}

// Plain-language detail panel for a use case: description, spec section
// (preconditions / flow / postconditions) and Given/When/Then scenarios.
// Returns '' when no narrative is available so the row stays non-expandable.
function renderUseCaseNarrative(uc, locale = 'es') {
  const narr = uc.narrative;
  const hasNarr = narr && (narr.spec || asArray(narr.flows).length);
  if (!hasNarr && !uc.description) return '';

  const parts = [];
  if (uc.description) {
    parts.push(`<p class="mb-2">${escapeHtml(uc.description)}</p>`);
  }
  if (narr && narr.spec && narr.spec.html) {
    parts.push(`<div class="narrative-spec mb-2">${narr.spec.html}</div>`);
  }
  const flows = narr ? asArray(narr.flows) : [];
  if (flows.length) {
    const flowBlocks = flows.map((f) => `
      <details class="narrative-flow mb-2" open>
        <summary class="fw-semibold small"><span class="font-monospace">${escapeHtml(f.id)}</span> · ${escapeHtml(f.title)}</summary>
        <div class="mt-2">${f.html}</div>
      </details>`).join('');
    parts.push(`
      <h6 class="text-uppercase text-muted small mt-3 mb-2" data-i18n="ui.flows">${i18nText('ui.flows', locale)}</h6>
      ${flowBlocks}`);
  }
  return parts.join('\n');
}

function renderUseCaseRows(rows, locale = 'es') {
  return rows.map((uc) => {
    const sagaBadge = uc.saga
      ? `<a href="#saga-${escapeHtml(slug(uc.saga.saga))}" class="badge bg-dark text-decoration-none" title="${escapeHtml(uc.saga.saga)}">${escapeHtml(uc.saga.saga)}${uc.saga.order != null ? ' #' + escapeHtml(uc.saga.order) : ''}</a>`
      : '<span class="text-muted">—</span>';
    const anchor = uc.id ? `uc-${slug(uc.id)}` : '';
    const detail = renderUseCaseNarrative(uc, locale);
    const toggle = detail
      ? `<button type="button" class="btn btn-sm btn-link p-0 uc-toggle" data-uc-toggle="${anchor}-detail" aria-expanded="false" title="${i18nText('ui.expandDetail', locale)}"><span class="uc-caret">&#9656;</span></button>`
      : '';
    const mainRow = `
      <tr${anchor ? ` id="${anchor}"` : ''}${detail ? ' class="uc-row"' : ''}${detail ? ` data-uc-toggle="${anchor}-detail"` : ''}>
        <td class="text-center">${toggle}</td>
        <td class="font-monospace small">${escapeHtml(uc.id)}</td>
        <td>${escapeHtml(uc.name)}${behaviorBadges(uc, locale)}</td>
        <td><span class="badge bg-${actorBadgeClass(uc.actor)}">${escapeHtml(uc.actor || '—')}</span></td>
        <td><span class="badge bg-${ucTypeBadgeClass(uc.type)}">${escapeHtml(uc.type || '—')}</span></td>
        <td class="font-monospace small">${escapeHtml(uc.triggerLabel)}</td>
        <td class="font-monospace small">${escapeHtml(uc.target)}</td>
        <td>${rulePills(uc.ruleDetails, locale)}</td>
        <td>${sagaBadge}</td>
      </tr>`;
    const detailRow = detail
      ? `<tr class="uc-detail-row" id="${anchor}-detail" hidden><td></td><td colspan="8"><div class="uc-detail">${detail}</div></td></tr>`
      : '';
    return mainRow + detailRow;
  }).join('');
}

function renderStorageSummary(storageUsage, locale = 'es') {
  if (!asArray(storageUsage).length) {
    return `<p class="text-muted small" data-i18n="ui.noStorageBuckets">${i18nText('ui.noStorageBuckets', locale)}</p>`;
  }
  const rows = storageUsage.map((entry) => {
    const visibilityBadge = entry.visibility === 'public'
      ? `<span class="badge bg-info text-dark">${escapeHtml(entry.visibility)}</span>`
      : `<span class="badge bg-secondary">${escapeHtml(entry.visibility)}</span>`;
    const urlBadge = entry.urlAccess === 'public-url'
      ? `<span class="badge bg-success">${escapeHtml(entry.urlAccess)}</span>`
      : `<span class="badge bg-warning text-dark">${escapeHtml(entry.urlAccess)}</span>`;
    const ownedByBadge = entry.ownedBy !== '—'
      ? `<span class="badge bg-dark">${escapeHtml(entry.ownedBy)}</span>`
      : '<span class="text-muted">—</span>';
    const ops = entry.usages.map((u) =>
      `<span class="badge bg-light text-dark border me-1 font-monospace" title="${escapeHtml(u.ucName)}">${escapeHtml(u.ucId)} <em>${escapeHtml(u.operation)}</em></span>`
    ).join('');
    const notes = entry.notes
      ? `<div class="text-muted small mt-1">${escapeHtml(entry.notes)}</div>`
      : '';
    return `
      <tr>
        <td><span class="font-monospace">${escapeHtml(entry.store)}</span>${notes}</td>
        <td>${visibilityBadge}</td>
        <td>${urlBadge}${entry.signedUrlTtl ? `<span class="ms-1 text-muted small">${escapeHtml(entry.signedUrlTtl)}</span>` : ''}</td>
        <td>${ownedByBadge}</td>
        <td>${ops}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">
      <thead class="table-light"><tr>
        <th data-i18n="storage.store">${i18nText('storage.store', locale)}</th>
        <th data-i18n="storage.visibility">${i18nText('storage.visibility', locale)}</th>
        <th data-i18n="storage.urlAccess">${i18nText('storage.urlAccess', locale)}</th>
        <th data-i18n="storage.ownedBy">${i18nText('storage.ownedBy', locale)}</th>
        <th data-i18n="storage.operations">${i18nText('storage.operations', locale)}</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>`;
}

function renderUseCaseCatalog(catalog, locale = 'es') {
  if (!asArray(catalog).length) return `<p class="text-muted small" data-i18n="ui.noUseCases">${i18nText('ui.noUseCases', locale)}</p>`;
  const http = catalog.filter((uc) => uc.triggerKind === 'http');
  const events = catalog.filter((uc) => uc.triggerKind !== 'http');
  const group = (titleKey, rows) => rows.length ? `
    <h6 class="text-uppercase text-muted small mt-3 mb-2" data-i18n="${titleKey}">${i18nText(titleKey, locale)}</h6>
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">
      ${useCaseTableHead(locale)}<tbody>${renderUseCaseRows(rows, locale)}</tbody>
    </table></div>` : '';
  return group('ui.httpTriggered', http) + group('ui.eventTriggered', events);
}

function renderSecurityMatrix(matrix, locale = 'es') {
  if (!asArray(matrix).length) return `<p class="text-muted small" data-i18n="ui.noEndpoints">${i18nText('ui.noEndpoints', locale)}</p>`;
  const rows = matrix.map((entry) => {
    const access = entry.public
      ? `<span class="badge bg-info text-dark" data-i18n="sec.public">${i18nText('sec.public', locale)}</span>`
      : (entry.unprotected
        ? `<span class="badge bg-danger" data-i18n="sec.unprotected">${i18nText('sec.unprotected', locale)}</span>`
        : `<span class="badge bg-success" data-i18n="sec.protected">${i18nText('sec.protected', locale)}</span>`);
    const ownership = entry.ownership
      ? `<span class="font-monospace small">${escapeHtml(entry.ownership.field)} ↔ ${escapeHtml(entry.ownership.claim)}</span>`
      : '<span class="text-muted">—</span>';
    const warn = entry.unprotected
      ? `<div class="small text-danger mt-1" data-i18n="sec.unprotectedWarn">${i18nText('sec.unprotectedWarn', locale)}</div>`
      : '';
    return `
      <tr class="${entry.unprotected ? 'table-danger' : ''}">
        <td><div class="font-monospace small">${escapeHtml(entry.endpoint)}</div><div class="text-muted small">${escapeHtml(entry.id)} ${escapeHtml(entry.name)}</div>${warn}</td>
        <td>${access}</td>
        <td>${pillList(entry.roles, 'text-bg-primary')}</td>
        <td>${pillList(entry.permissions, 'text-bg-secondary')}</td>
        <td>${pillList(entry.scopes, 'text-bg-dark')}</td>
        <td>${ownership}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">
      <thead class="table-light"><tr>
        <th data-i18n="sec.endpoint">${i18nText('sec.endpoint', locale)}</th>
        <th data-i18n="sec.access">${i18nText('sec.access', locale)}</th>
        <th data-i18n="sec.roles">${i18nText('sec.roles', locale)}</th>
        <th data-i18n="sec.permissions">${i18nText('sec.permissions', locale)}</th>
        <th data-i18n="sec.scopes">${i18nText('sec.scopes', locale)}</th>
        <th data-i18n="sec.ownership">${i18nText('sec.ownership', locale)}</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>`;
}

// Focused reliability view: answers "where is idempotency applied?" and "which
// endpoints are cached?" directly, instead of leaving them as two cells in the
// dense (and collapsed) operations matrix. Derived from the same operations
// matrix entries (uc.idempotency / uc.cacheable) — no extra data needed.
function renderReliabilityPanel(matrix, locale = 'es') {
  const entries = asArray(matrix);
  const idempotent = entries.filter((e) => e.idempotency);
  const cached = entries.filter((e) => e.cache);

  const endpointCell = (e) =>
    `<td><div class="font-monospace small">${escapeHtml(e.endpoint)}</div><div class="text-muted small">${escapeHtml(e.id)} ${escapeHtml(e.name)}</div></td>`;

  const idempotentBlock = idempotent.length
    ? `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
        <thead class="table-light"><tr>
          <th data-i18n="rel.endpoint">${i18nText('rel.endpoint', locale)}</th>
          <th data-i18n="rel.header">${i18nText('rel.header', locale)}</th>
          <th data-i18n="rel.ttl">${i18nText('rel.ttl', locale)}</th>
          <th data-i18n="rel.storage">${i18nText('rel.storage', locale)}</th>
        </tr></thead><tbody>${idempotent.map((e) => `
          <tr>
            ${endpointCell(e)}
            <td><span class="badge bg-primary">${escapeHtml(e.idempotency.header)}</span></td>
            <td class="font-monospace small">${escapeHtml(e.idempotency.ttl || '—')}</td>
            <td><span class="badge bg-light text-dark border">cache</span></td>
          </tr>`).join('')}</tbody>
      </table></div>`
    : `<p class="text-muted small" data-i18n="ui.noIdempotency">${i18nText('ui.noIdempotency', locale)}</p>`;

  const cachedBlock = cached.length
    ? `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
        <thead class="table-light"><tr>
          <th data-i18n="rel.endpoint">${i18nText('rel.endpoint', locale)}</th>
          <th data-i18n="rel.ttl">${i18nText('rel.ttl', locale)}</th>
          <th data-i18n="rel.keyFields">${i18nText('rel.keyFields', locale)}</th>
        </tr></thead><tbody>${cached.map((e) => `
          <tr>
            ${endpointCell(e)}
            <td><span class="badge bg-info text-dark">${escapeHtml(e.cache.ttl || '—')}</span></td>
            <td>${e.cache.keyFields.length ? `<span class="font-monospace small">${escapeHtml(e.cache.keyFields.join(', '))}</span>` : '<span class="text-muted">—</span>'}</td>
          </tr>`).join('')}</tbody>
      </table></div>`
    : `<p class="text-muted small" data-i18n="ui.noCache">${i18nText('ui.noCache', locale)}</p>`;

  return `
    <h6 class="text-uppercase text-muted small mb-2" data-i18n="ui.reliabilityIdempotent">${i18nText('ui.reliabilityIdempotent', locale)}</h6>
    ${idempotentBlock}
    <h6 class="text-uppercase text-muted small mt-3 mb-2" data-i18n="ui.reliabilityCached">${i18nText('ui.reliabilityCached', locale)}</h6>
    ${cachedBlock}`;
}

// Dedicated, scannable view of every Given/When/Then scenario in {bc}-flows.md
// so the human can read and give feedback. Scenarios are grouped by their
// flows.md heading and each segment (Given/When/Then/edge cases) is rendered as
// a color-differentiated block. Read-only by design (no copy-prompt buttons).
function renderScenarios(scenarios, locale = 'es') {
  const list = asArray(scenarios);
  if (!list.length) return `<p class="text-muted small" data-i18n="ui.noScenarios">${i18nText('ui.noScenarios', locale)}</p>`;

  // Map known Spanish/English flow labels to a localized display + style class.
  const segMeta = (label) => {
    const norm = String(label || '').trim().toLowerCase();
    if (/^(given|dado)/.test(norm)) return { cls: 'given', text: i18nText('flow.given', locale) };
    if (/^(when|cuando)/.test(norm)) return { cls: 'when', text: i18nText('flow.when', locale) };
    if (/^(then|entonces)/.test(norm)) return { cls: 'then', text: i18nText('flow.then', locale) };
    if (/borde|edge/.test(norm)) return { cls: 'edge', text: i18nText('flow.edgeCases', locale) };
    return { cls: 'other', text: label };
  };

  const renderScenario = (sc) => {
    const segs = asArray(sc.segments).map((seg) => {
      if (!seg.label) return `<div class="flow-seg flow-seg--intro">${seg.html}</div>`;
      const meta = segMeta(seg.label);
      return `<div class="flow-seg flow-seg--${meta.cls}">
        <span class="flow-seg-label">${escapeHtml(meta.text)}</span>
        <div class="flow-seg-body">${seg.html}</div>
      </div>`;
    }).join('');
    return `<div class="scenario-card mb-3">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-2">
        <span class="badge bg-dark font-monospace">${escapeHtml(sc.id)}</span>
        <span class="fw-semibold">${escapeHtml(sc.title)}</span>
      </div>
      ${segs}
    </div>`;
  };

  // Group by flows.md heading, preserving document order.
  const groups = [];
  for (const sc of list) {
    const g = sc.group || '';
    let bucket = groups.find((x) => x.group === g);
    if (!bucket) { bucket = { group: g, items: [] }; groups.push(bucket); }
    bucket.items.push(sc);
  }
  return groups.map((bucket) => `
    ${bucket.group ? `<h6 class="text-uppercase text-muted small mt-3 mb-2">${escapeHtml(bucket.group)}</h6>` : ''}
    ${bucket.items.map(renderScenario).join('')}`).join('');
}

function renderOperationsMatrix(matrix, locale = 'es') {
  if (!asArray(matrix).length) return `<p class="text-muted small" data-i18n="ui.noUseCases">${i18nText('ui.noUseCases', locale)}</p>`;
  const dash = '<span class="text-muted">—</span>';
  const rows = matrix.map((entry) => {
    const idempotency = entry.idempotency
      ? `<span class="badge bg-primary" title="storage: cache">${escapeHtml(entry.idempotency.header)}${entry.idempotency.ttl ? ' · ' + escapeHtml(entry.idempotency.ttl) : ''}</span>`
      : dash;
    const cache = entry.cache
      ? `<span class="badge bg-info text-dark">${escapeHtml(entry.cache.ttl || '—')}${entry.cache.keyFields.length ? ' · [' + escapeHtml(entry.cache.keyFields.join(', ')) + ']' : ''}</span>`
      : dash;
    const async = entry.async
      ? `<span class="badge bg-secondary" title="${escapeHtml(entry.async.statusEndpoint || '')}">${escapeHtml(entry.async.mode || 'async')}</span>`
      : dash;
    const bulk = entry.bulk
      ? `<span class="badge bg-dark">${escapeHtml(String(entry.bulk.maxItems || '∞'))}${entry.bulk.onItemError ? ' · ' + escapeHtml(entry.bulk.onItemError) : ''}</span>`
      : dash;
    const pagination = entry.pagination
      ? `<span class="font-monospace small">${escapeHtml(String(entry.pagination.defaultSize || '—'))}/${escapeHtml(String(entry.pagination.maxSize || '—'))}${entry.pagination.sort ? ' · ' + escapeHtml(entry.pagination.sort) : ''}</span>`
      : dash;
    const implementation = `<span class="badge bg-${entry.implementation === 'scaffold' ? 'warning text-dark' : 'success'}">${escapeHtml(entry.implementation)}</span>`;
    const depsParts = [];
    if (entry.deps.fk) depsParts.push(`${entry.deps.fk} fk`);
    if (entry.deps.outgoing) depsParts.push(`${entry.deps.outgoing} out`);
    if (entry.deps.lookups) depsParts.push(`${entry.deps.lookups} lkp`);
    const deps = depsParts.length
      ? `<span class="badge bg-light text-dark border" title="${escapeHtml(entry.deps.detail.join('\n'))}">${escapeHtml(depsParts.join(' · '))}</span>`
      : dash;
    return `
      <tr>
        <td><div class="font-monospace small">${escapeHtml(entry.endpoint)}</div><div class="text-muted small">${escapeHtml(entry.id)} ${escapeHtml(entry.name)}</div></td>
        <td><span class="badge bg-${ucTypeBadgeClass(entry.type)}">${escapeHtml(entry.type || '—')}</span></td>
        <td>${idempotency}</td>
        <td>${cache}</td>
        <td>${async}</td>
        <td>${bulk}</td>
        <td>${pagination}</td>
        <td>${implementation}</td>
        <td>${deps}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">
      <thead class="table-light"><tr>
        <th data-i18n="ops.endpoint">${i18nText('ops.endpoint', locale)}</th>
        <th data-i18n="uc.type">${i18nText('uc.type', locale)}</th>
        <th data-i18n="ops.idempotency">${i18nText('ops.idempotency', locale)}</th>
        <th data-i18n="ops.cache">${i18nText('ops.cache', locale)}</th>
        <th data-i18n="ops.async">${i18nText('ops.async', locale)}</th>
        <th data-i18n="ops.bulk">${i18nText('ops.bulk', locale)}</th>
        <th data-i18n="ops.pagination">${i18nText('ops.pagination', locale)}</th>
        <th data-i18n="ops.implementation">${i18nText('ops.implementation', locale)}</th>
        <th data-i18n="ops.dependencies">${i18nText('ops.dependencies', locale)}</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>`;
}

function renderSagaViews(sagas, locale = 'es') {
  if (!asArray(sagas).length) return `<p class="text-muted small" data-i18n="ui.noSagas">${i18nText('ui.noSagas', locale)}</p>`;
  return sagas.map((saga) => {
    const stepRows = saga.steps.map((step) => {
      const impl = step.implementedBy
        ? `<span class="font-monospace small">${escapeHtml(step.implementedBy.bc)}/${escapeHtml(step.implementedBy.id)}</span> ${escapeHtml(step.implementedBy.name)}`
        : '<span class="text-muted">—</span>';
      return `
        <tr>
          <td>${escapeHtml(step.order)}</td>
          <td><span class="badge bg-secondary">${escapeHtml(step.bc)}</span></td>
          <td class="font-monospace small">${escapeHtml(step.triggeredBy || '—')}</td>
          <td class="font-monospace small text-success">${escapeHtml(step.onSuccess || '—')}</td>
          <td class="font-monospace small text-danger">${escapeHtml(step.onFailure || '—')}</td>
          <td class="font-monospace small">${escapeHtml(step.compensation || '—')}</td>
          <td>${impl}</td>
        </tr>`;
    }).join('');
    return `
      <article class="saga-card mb-4">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <h6 class="mb-0">${escapeHtml(saga.name)}</h6>
          <span class="badge bg-light text-dark border"><span data-i18n="saga.trigger">${i18nText('saga.trigger', locale)}</span>: ${escapeHtml(saga.trigger.event)} (${escapeHtml(saga.trigger.bc)})</span>
        </div>
        ${saga.description ? `<p class="small text-muted mb-2">${escapeHtml(saga.description)}</p>` : ''}
        <div class="saga-diagram mb-3"><pre class="mermaid">${escapeHtml(saga.mermaid)}</pre></div>
        <div class="table-responsive"><table class="table table-sm table-hover align-middle">
          <thead class="table-light"><tr>
            <th data-i18n="saga.step">${i18nText('saga.step', locale)}</th>
            <th data-i18n="saga.bc">${i18nText('saga.bc', locale)}</th>
            <th data-i18n="saga.triggeredBy">${i18nText('saga.triggeredBy', locale)}</th>
            <th data-i18n="saga.onSuccess">${i18nText('saga.onSuccess', locale)}</th>
            <th data-i18n="saga.onFailure">${i18nText('saga.onFailure', locale)}</th>
            <th data-i18n="saga.compensation">${i18nText('saga.compensation', locale)}</th>
            <th data-i18n="saga.implementedBy">${i18nText('saga.implementedBy', locale)}</th>
          </tr></thead><tbody>${stepRows}</tbody>
        </table></div>
      </article>`;
  }).join('');
}

function renderSagaParticipation(bcName, sagas, locale = 'es') {
  const rows = [];
  for (const saga of asArray(sagas)) {
    for (const step of saga.steps) {
      if (step.bc === bcName || (step.implementedBy && step.implementedBy.bc === bcName)) {
        rows.push({ saga: saga.name, ...step });
      }
    }
  }
  if (!rows.length) return `<p class="text-muted small" data-i18n="ui.noSagaParticipation">${i18nText('ui.noSagaParticipation', locale)}</p>`;
  const seenSaga = new Set();
  const body = rows.map((step) => {
    // First row of each saga carries the #saga-<slug> anchor that use-case rows
    // link to. The implementing use case links back to its #uc-<id> row.
    const sagaAnchor = seenSaga.has(step.saga) ? '' : ` id="saga-${slug(step.saga)}"`;
    seenSaga.add(step.saga);
    const impl = step.implementedBy
      ? (step.implementedBy.bc === bcName
        ? `<a href="#uc-${slug(step.implementedBy.id)}" class="text-decoration-none">${escapeHtml(`${step.implementedBy.id} ${step.implementedBy.name}`)}</a>`
        : escapeHtml(`${step.implementedBy.bc}/${step.implementedBy.id} ${step.implementedBy.name}`))
      : '<span class="text-muted">—</span>';
    return `
    <tr${sagaAnchor}>
      <td><span class="badge bg-dark">${escapeHtml(step.saga)}</span></td>
      <td>${escapeHtml(step.order)}</td>
      <td class="font-monospace small">${escapeHtml(step.triggeredBy || '—')}</td>
      <td class="font-monospace small text-success">${escapeHtml(step.onSuccess || '—')}</td>
      <td class="font-monospace small">${escapeHtml(step.compensation || '—')}</td>
      <td>${impl}</td>
    </tr>`;
  }).join('');
  return `
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">
      <thead class="table-light"><tr>
        <th data-i18n="uc.saga">${i18nText('uc.saga', locale)}</th>
        <th data-i18n="saga.step">${i18nText('saga.step', locale)}</th>
        <th data-i18n="saga.triggeredBy">${i18nText('saga.triggeredBy', locale)}</th>
        <th data-i18n="saga.onSuccess">${i18nText('saga.onSuccess', locale)}</th>
        <th data-i18n="saga.compensation">${i18nText('saga.compensation', locale)}</th>
        <th data-i18n="saga.implementedBy">${i18nText('saga.implementedBy', locale)}</th>
      </tr></thead><tbody>${body}</tbody>
    </table></div>`;
}

function renderEvents(events, locale = 'es') {
  const published = asArray(events && events.published);
  const consumed = asArray(events && events.consumed);
  const readModels = asArray(events && events.readModels);
  if (!published.length && !consumed.length && !readModels.length) {
    return `<p class="text-muted small" data-i18n="ui.noEvents">${i18nText('ui.noEvents', locale)}</p>`;
  }
  const sub = (titleKey, head, body) => `
    <h6 class="text-uppercase text-muted small mt-3 mb-2" data-i18n="${titleKey}">${i18nText(titleKey, locale)}</h6>
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">${head}<tbody>${body}</tbody></table></div>`;

  // Published events carry an #event-<slug> anchor so consumers in other BC
  // pages can deep-link to the producer's declaration.
  const pub = published.length ? sub('events.published',
    `<thead class="table-light"><tr><th data-i18n="events.name">${i18nText('events.name', locale)}</th><th data-i18n="events.channel">${i18nText('events.channel', locale)}</th><th data-i18n="events.scope">${i18nText('events.scope', locale)}</th><th data-i18n="events.payload">${i18nText('events.payload', locale)}</th></tr></thead>`,
    published.map((e) => `<tr id="event-${slug(e.name)}"><td>${escapeHtml(e.name)}</td><td class="font-monospace small">${escapeHtml(e.channel || '—')}</td><td>${escapeHtml(e.scope || '—')}</td><td>${pillList(e.payload, 'text-bg-light border')}</td></tr>`).join('')) : '';

  // Consumed events link back to the producing BC's review page at the event anchor.
  const con = consumed.length ? sub('events.consumed',
    `<thead class="table-light"><tr><th data-i18n="events.name">${i18nText('events.name', locale)}</th><th data-i18n="events.sourceBc">${i18nText('events.sourceBc', locale)}</th><th data-i18n="events.channel">${i18nText('events.channel', locale)}</th></tr></thead>`,
    consumed.map((e) => {
      const srcBadge = e.sourceBc
        ? `<a href="${escapeHtml(e.sourceBc)}-review.html#event-${slug(e.name)}" class="text-decoration-none"><span class="badge bg-secondary">${escapeHtml(e.sourceBc)}</span></a>`
        : '<span class="text-muted">—</span>';
      return `<tr><td>${escapeHtml(e.name)}</td><td>${srcBadge}</td><td class="font-monospace small">${escapeHtml(e.channel || '—')}</td></tr>`;
    }).join('')) : '';

  const rmd = readModels.length ? sub('events.readModels',
    `<thead class="table-light"><tr><th data-i18n="events.name">${i18nText('events.name', locale)}</th><th data-i18n="events.from">${i18nText('events.from', locale)}</th><th data-i18n="events.event">${i18nText('events.event', locale)}</th><th data-i18n="events.keyBy">${i18nText('events.keyBy', locale)}</th><th data-i18n="events.upsert">${i18nText('events.upsert', locale)}</th></tr></thead>`,
    readModels.map((rm) => `<tr><td>${escapeHtml(rm.name)}</td><td><span class="badge bg-secondary">${escapeHtml(rm.from || '—')}</span></td><td class="font-monospace small">${escapeHtml(rm.event || '—')}</td><td class="font-monospace small">${escapeHtml(rm.keyBy || '—')}</td><td>${escapeHtml(rm.upsertStrategy || '—')}</td></tr>`).join('')) : '';

  return pub + con + rmd;
}

function renderIntegrations(integrations, locale = 'es') {
  const outbound = asArray(integrations && integrations.outbound);
  const inbound = asArray(integrations && integrations.inbound);
  if (!outbound.length && !inbound.length) {
    return `<p class="text-muted small" data-i18n="int.noIntegrations">${i18nText('int.noIntegrations', locale)}</p>`;
  }

  const contextMap = (integrations && integrations.contextMap)
    ? `<h6 class="text-uppercase text-muted small mt-1 mb-2" data-i18n="int.contextMap">${i18nText('int.contextMap', locale)}</h6>
       <div class="saga-diagram mb-3"><pre class="mermaid">${escapeHtml(integrations.contextMap)}</pre></div>`
    : '';

  const head = `<thead class="table-light"><tr>
    <th data-i18n="int.partner">${i18nText('int.partner', locale)}</th>
    <th data-i18n="int.strategy">${i18nText('int.strategy', locale)}</th>
    <th data-i18n="int.channel">${i18nText('int.channel', locale)}</th>
    <th data-i18n="int.contracts">${i18nText('int.contracts', locale)}</th>
    <th data-i18n="int.triggers">${i18nText('int.triggers', locale)}</th>
    <th data-i18n="int.auth">${i18nText('int.auth', locale)}</th>
    <th data-i18n="int.resilience">${i18nText('int.resilience', locale)}</th>
    <th data-i18n="int.necessity">${i18nText('int.necessity', locale)}</th>
  </tr></thead>`;

  const row = (entry) => {
    const isExternal = String(entry.partnerType || '').toLowerCase().includes('external');
    const partnerBadge = `<span class="badge bg-secondary">${escapeHtml(entry.partner)}</span>${
      isExternal ? ` <span class="badge bg-warning text-dark" data-i18n="int.external">${i18nText('int.external', locale)}</span>` : ''}`;
    const necessity = entry.missingRationale
      ? `<span class="badge bg-warning text-dark" data-i18n="int.missingRationale">${i18nText('int.missingRationale', locale)}</span>`
      : `<span class="small">${escapeHtml(entry.rationale)}</span>`;
    return `
      <tr class="${entry.missingRationale ? 'table-warning' : ''}">
        <td>${partnerBadge}</td>
        <td><span class="badge bg-${entry.badge}">${escapeHtml(entry.patternLabel)}</span></td>
        <td class="font-monospace small">${escapeHtml(entry.channel || '—')}</td>
        <td>${pillList(entry.contracts, 'text-bg-light border')}</td>
        <td>${pillList(entry.triggers, 'text-bg-light border')}</td>
        <td class="font-monospace small">${escapeHtml(entry.auth || '—')}</td>
        <td class="font-monospace small">${escapeHtml(entry.resilience || '—')}</td>
        <td>${necessity}</td>
      </tr>`;
  };

  const group = (titleKey, rows) => rows.length ? `
    <h6 class="text-uppercase text-muted small mt-3 mb-2" data-i18n="${titleKey}">${i18nText(titleKey, locale)}</h6>
    <div class="table-responsive"><table class="table table-sm table-hover align-middle">${head}<tbody>${rows.map(row).join('')}</tbody></table></div>` : '';

  return contextMap + group('int.outbound', outbound) + group('int.inbound', inbound);
}

// Items the reviewer should look at first, derived from the BC review model:
// validation errors/warnings, unprotected endpoints, scaffold use cases and
// open decisions. Each links to the relevant in-page section.
function bcAttentionItems(bcReview, health) {
  const items = [];
  const scaffolds = asArray(bcReview.useCaseCatalog).filter((uc) => uc.implementation === 'scaffold').length;
  const gaps = asArray(bcReview.securityMatrix).filter((row) => row.unprotected).length;
  const openDecisions = asArray(bcReview.decisions).length;
  if (health.errors) items.push({ key: 'attention.errors', count: health.errors, level: 'error', href: '#sec-diagnostics' });
  if (health.warnings) items.push({ key: 'attention.warnings', count: health.warnings, level: 'warn', href: '#sec-diagnostics' });
  if (gaps) items.push({ key: 'attention.securityGaps', count: gaps, level: 'error', href: '#sec-security' });
  if (scaffolds) items.push({ key: 'attention.scaffolds', count: scaffolds, level: 'info', href: '#sec-usecases' });
  if (openDecisions) items.push({ key: 'attention.openDecisions', count: openDecisions, level: 'review', href: '#sec-decisions' });
  return items;
}

// System-wide attention items aggregated across all bounded contexts, for the
// dashboard's "needs your attention" panel.
function systemAttentionItems(reviewModel, health) {
  const items = [];
  const bcs = asArray(reviewModel.boundedContexts);
  const gaps = bcs.reduce((sum, bc) => sum + asArray(bc.securityMatrix).filter((r) => r.unprotected).length, 0);
  const scaffolds = bcs.reduce((sum, bc) => sum + asArray(bc.useCaseCatalog).filter((uc) => uc.implementation === 'scaffold').length, 0);
  if (health.errors) items.push({ key: 'attention.errors', count: health.errors, level: 'error', href: '#sec-system-diagnostics' });
  if (health.warnings) items.push({ key: 'attention.warnings', count: health.warnings, level: 'warn', href: '#sec-system-diagnostics' });
  if (gaps) items.push({ key: 'attention.securityGaps', count: gaps, level: 'error', href: 'proposals.html' });
  if (scaffolds) items.push({ key: 'attention.scaffolds', count: scaffolds, level: 'info', href: 'proposals.html' });
  return items;
}

function renderBcSummary(bcReview, locale = 'es') {
  const catalog = asArray(bcReview.useCaseCatalog);
  const commands = catalog.filter((uc) => uc.type === 'command').length;
  const queries = catalog.filter((uc) => uc.type === 'query').length;
  const published = asArray(bcReview.events && bcReview.events.published).length;
  const integrations = asArray(bcReview.integrations && bcReview.integrations.outbound).length
    + asArray(bcReview.integrations && bcReview.integrations.inbound).length;
  const sentence = i18nText('bc.summary', locale, {
    type: bcReview.type || '—',
    ucTotal: catalog.length,
    commands,
    queries,
    published,
    integrations,
  });
  return `<p class="mb-0 text-body-secondary">${sentence}</p>`;
}

function renderAttentionPanel(items, locale = 'es') {
  if (!items.length) {
    return `<div class="attention-card is-ok p-3 rounded bg-body"><span class="text-success">&#10003;</span> <span data-i18n="attention.allClear">${i18nText('attention.allClear', locale)}</span></div>`;
  }
  const badgeClass = { error: 'bg-danger', warn: 'bg-warning text-dark', info: 'bg-info text-dark', review: 'bg-secondary' };
  const worst = items.some((it) => it.level === 'error') ? 'is-error' : '';
  const chips = items.map((it) =>
    `<a href="${it.href}" class="text-decoration-none"><span class="badge ${badgeClass[it.level] || 'bg-secondary'}">${i18nText(it.key, locale, { count: it.count })}</span></a>`
  ).join(' ');
  return `<div class="attention-card ${worst} p-3 rounded bg-body">
    <div class="text-uppercase small fw-semibold text-body-secondary mb-2" data-i18n="ui.attentionRequired">${i18nText('ui.attentionRequired', locale)}</div>
    <div class="d-flex flex-wrap gap-2">${chips}</div>
  </div>`;
}

function renderReviewSideNav(sections, locale = 'es') {
  const links = sections.map((s) =>
    `<a href="#${s.id}"><span data-i18n="${s.key}">${i18nText(s.key, locale)}</span></a>`
  ).join('');
  return `<nav class="review-nav d-none d-lg-block">
    <div class="text-uppercase small fw-semibold text-body-secondary mb-2" data-i18n="ui.onThisPage">${i18nText('ui.onThisPage', locale)}</div>
    ${links}
  </nav>`;
}

// One review section. Dense sections are wrapped in a collapsible shell with a
// count badge so the reviewer can fold what they are not inspecting.
function reviewSection(id, titleKey, body, locale, opts = {}) {
  const count = opts.count != null ? `<span class="badge bg-light text-dark border ms-2">${escapeHtml(opts.count)}</span>` : '';
  if (opts.collapsible) {
    return `<section id="${id}" class="mb-4 collapsible-section${opts.collapsed ? ' collapsed' : ''}">
      <h2 class="h5 mb-3 section-toggle d-flex align-items-center"><span class="uc-caret me-2">&#9656;</span><span data-i18n="${titleKey}">${i18nText(titleKey, locale)}</span>${count}</h2>
      <div class="section-body">${body}</div>
    </section>`;
  }
  return `<section id="${id}" class="mb-4">
    <h2 class="h5 mb-3"><span data-i18n="${titleKey}">${i18nText(titleKey, locale)}</span>${count}</h2>
    ${body}
  </section>`;
}

function buildBcReviewHtml(bcReview, generatedAt, locale = 'es') {
  const health = countDiagnostics(bcReview.diagnostics);
  const linkButtons = [
    bcReview.links.designFile ? `<a class="btn btn-sm btn-outline-dark" href="${escapeHtml(bcReview.links.designFile)}" data-i18n="nav.diagrams">${i18nText('nav.diagrams', locale)}</a>` : '',
    bcReview.links.openApiFile ? `<a class="btn btn-sm btn-outline-success" href="${escapeHtml(bcReview.links.openApiFile)}" data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</a>` : '',
    bcReview.links.asyncApiFile ? `<a class="btn btn-sm btn-outline-primary" href="${escapeHtml(bcReview.links.asyncApiFile)}" data-i18n="nav.events">${i18nText('nav.events', locale)}</a>` : '',
  ].filter(Boolean).join('');

  const navSections = [
    { id: 'sec-decisions', key: 'ui.designDecisions' },
    { id: 'sec-usecases', key: 'ui.useCaseCatalog' },
    { id: 'sec-scenarios', key: 'ui.scenarios' },
    { id: 'sec-events', key: 'ui.eventsReadModels' },
    { id: 'sec-sagas', key: 'ui.sagaParticipation' },
    { id: 'sec-security', key: 'ui.endpointSecurity' },
    { id: 'sec-reliability', key: 'ui.reliability' },
    { id: 'sec-operations', key: 'ui.operationalBehavior' },
    { id: 'sec-integrations', key: 'ui.directIntegrations' },
    { id: 'sec-storage', key: 'ui.storageBuckets' },
    { id: 'sec-diagnostics', key: 'ui.validationHealth' },
  ];

  const attention = bcAttentionItems(bcReview, health);

  const sectionsHtml = [
    reviewSection('sec-decisions', 'ui.designDecisions', renderDecisionCards(bcReview.decisions, locale), locale, { count: asArray(bcReview.decisions).length }),
    reviewSection('sec-usecases', 'ui.useCaseCatalog', `<div class="detail-card">${renderUseCaseCatalog(bcReview.useCaseCatalog, locale)}</div>`, locale, { count: asArray(bcReview.useCaseCatalog).length }),
    reviewSection('sec-scenarios', 'ui.scenarios', `<div class="detail-card">${renderScenarios(bcReview.scenarios, locale)}</div>`, locale, { count: asArray(bcReview.scenarios).length }),
    reviewSection('sec-events', 'ui.eventsReadModels', `<div class="detail-card">${renderEvents(bcReview.events, locale)}</div>`, locale),
    reviewSection('sec-sagas', 'ui.sagaParticipation', `<div class="detail-card">${renderSagaParticipation(bcReview.name, bcReview.sagas, locale)}</div>`, locale),
    reviewSection('sec-security', 'ui.endpointSecurity', `<div class="detail-card">${renderSecurityMatrix(bcReview.securityMatrix, locale)}</div>`, locale, { collapsible: true, count: asArray(bcReview.securityMatrix).length }),
    reviewSection('sec-reliability', 'ui.reliability', `<div class="detail-card">${renderReliabilityPanel(bcReview.operationsMatrix, locale)}</div>`, locale),
    reviewSection('sec-operations', 'ui.operationalBehavior', `<div class="detail-card">${renderOperationsMatrix(bcReview.operationsMatrix, locale)}</div>`, locale, { collapsible: true, collapsed: true, count: asArray(bcReview.operationsMatrix).length }),
    reviewSection('sec-integrations', 'ui.directIntegrations', `<div class="detail-card">${renderIntegrations(bcReview.integrations, locale)}</div>`, locale),
    reviewSection('sec-storage', 'ui.storageBuckets', `<div class="detail-card">${renderStorageSummary(bcReview.storage, locale)}</div>`, locale, { collapsible: true, collapsed: true }),
    reviewSection('sec-diagnostics', 'ui.validationHealth', renderDiagnostics(bcReview.diagnostics, locale), locale, { count: health.total }),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcReview.name)} — ${i18nText('ui.decisionReview', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  ${themeBootScript()}
  ${mermaidScriptTag()}
  <style>${reviewSharedStyles()}</style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(bcReview.name)} — <span data-i18n="ui.decisionReview">${i18nText('ui.decisionReview', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">${linkButtons}${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <main class="container-xl pb-5">
    <div class="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
      <div>
        <h1 class="h4 mb-1">${escapeHtml(bcReview.name)} <span class="badge bg-${({ core: 'primary', supporting: 'purple', generic: 'secondary' })[bcReview.type] || 'secondary'} align-middle">${escapeHtml(bcReview.type || '—')}</span></h1>
        <p class="text-muted mb-0">${bcReview.purpose ? escapeHtml(bcReview.purpose) : i18nSpan('ui.noPurpose', locale)}</p>
      </div>
      <div class="text-end small text-muted">
        <div>${escapeHtml(generatedAt)}</div>
        <div><span class="badge bg-${health.errors ? 'danger' : (health.warnings ? 'warning text-dark' : 'success')}">${i18nText('ui.errorsWarnings', locale, health)}</span></div>
      </div>
    </div>

    <div class="detail-card mb-3">${renderBcSummary(bcReview, locale)}</div>
    <div class="mb-4">${renderAttentionPanel(attention, locale)}</div>

    ${renderMetricTiles(bcReview.metrics)}

    <div class="row">
      <div class="col-lg-2">${renderReviewSideNav(navSections, locale)}</div>
      <div class="col-lg-10">
        ${sectionsHtml}
      </div>
    </div>
  </main>
  ${clientI18nScript(locale)}
  ${clientThemeScript()}
  ${mermaidRenderAllScript()}
  ${reviewInteractionScript()}
</body>
</html>`;
}

// ─── Decision explorer (global, cross-BC) ─────────────────────────────────────

function renderDecisionsExplorer(reviewModel, locale = 'es') {
  const designedBcs = asArray(reviewModel.boundedContexts).filter((bc) => bc.hasDesign);

  const bcOptions = ['<option value="all" data-i18n="ui.all">' + i18nText('ui.all', locale) + '</option>']
    .concat(designedBcs.map((bc) => `<option value="${escapeHtml(bc.name)}">${escapeHtml(bc.name)}</option>`))
    .join('');

  const catOptions = [
    ['all', 'ui.all'],
    ['use-cases', 'ui.useCaseCatalog'],
    ['security', 'ui.endpointSecurity'],
    ['operations', 'ui.operationalBehavior'],
    ['sagas', 'ui.systemSagas'],
    ['events', 'ui.eventsReadModels'],
    ['storage', 'ui.storageBuckets'],
    ['integrations', 'ui.directIntegrations'],
  ].map(([value, key]) => `<option value="${value}" data-i18n="${key}">${i18nText(key, locale)}</option>`).join('');

  const block = (bcName, cat, titleKey, body) => `
    <section class="detail-card explorer-block" data-bc="${escapeHtml(bcName)}" data-cat="${cat}">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h2 class="h6 mb-0"><span data-i18n="${titleKey}">${i18nText(titleKey, locale)}</span></h2>
        ${bcName !== '__all__' ? `<span class="badge bg-secondary">${escapeHtml(bcName)}</span>` : ''}
      </div>
      ${body}
    </section>`;

  const sagaBlock = block('__all__', 'sagas', 'ui.systemSagas', renderSagaViews(reviewModel.sagas, locale));

  const bcBlocks = designedBcs.map((bc) => [
    block(bc.name, 'use-cases', 'ui.useCaseCatalog', renderUseCaseCatalog(bc.useCaseCatalog, locale)),
    block(bc.name, 'security', 'ui.endpointSecurity', renderSecurityMatrix(bc.securityMatrix, locale)),
    block(bc.name, 'operations', 'ui.operationalBehavior', renderOperationsMatrix(bc.operationsMatrix, locale)),
    block(bc.name, 'events', 'ui.eventsReadModels', renderEvents(bc.events, locale)),
    block(bc.name, 'storage', 'ui.storageBuckets', renderStorageSummary(bc.storage, locale)),
    block(bc.name, 'integrations', 'ui.directIntegrations', renderIntegrations(bc.integrations, locale)),
  ].join('')).join('');

  return `
    <div class="row g-2 align-items-end mb-4">
      <div class="col-sm-4">
        <label class="form-label small mb-1" for="filter-bc" data-i18n="ui.filterByBc">${i18nText('ui.filterByBc', locale)}</label>
        <select id="filter-bc" class="form-select form-select-sm">${bcOptions}</select>
      </div>
      <div class="col-sm-4">
        <label class="form-label small mb-1" for="filter-cat" data-i18n="ui.filterByCategory">${i18nText('ui.filterByCategory', locale)}</label>
        <select id="filter-cat" class="form-select form-select-sm">${catOptions}</select>
      </div>
    </div>
    ${sagaBlock}
    ${bcBlocks}
    <script>
      (function () {
        var bcSel = document.getElementById('filter-bc');
        var catSel = document.getElementById('filter-cat');
        var blocks = Array.prototype.slice.call(document.querySelectorAll('.explorer-block'));
        function applyFilters() {
          var bc = bcSel.value, cat = catSel.value;
          blocks.forEach(function (b) {
            var bbc = b.getAttribute('data-bc'), bcat = b.getAttribute('data-cat');
            var showBc = (bc === 'all') || (bbc === '__all__') || (bbc === bc);
            var showCat = (cat === 'all') || (bcat === cat);
            b.style.display = (showBc && showCat) ? '' : 'none';
          });
        }
        bcSel.addEventListener('change', applyFilters);
        catSel.addEventListener('change', applyFilters);
      })();
    <\/script>`;
}

function buildDecisionsExplorerHtml(systemData, reviewModel, generatedAt, locale = 'es') {
  const systemName = systemData?.system?.name ?? t(locale, 'ui.designReview');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(systemName)} — ${i18nText('ui.decisionsExplorer', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  ${themeBootScript()}
  ${mermaidScriptTag()}
  <style>${reviewSharedStyles()}</style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(systemName)} — <span data-i18n="ui.decisionsExplorer">${i18nText('ui.decisionsExplorer', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap"><span class="text-muted small">${escapeHtml(generatedAt)}</span>${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
    </div>
  </nav>
  <main class="container-xl pb-5">
    ${renderDecisionsExplorer(reviewModel, locale)}
  </main>
  ${clientI18nScript(locale)}
  ${clientThemeScript()}
  ${mermaidRenderAllScript()}
  ${reviewInteractionScript()}
</body>
</html>`;
}

// Render the iteration proposals (open decisions, security gaps and validation
// diagnostics) as an in-browser, prioritized panel with copy-ready agent
// prompts — so the reviewer iterates from the HTML instead of opening the YAML.
function renderProposalCards(proposals, locale = 'es') {
  if (!asArray(proposals).length) {
    return `<div class="alert alert-success" data-i18n="prop.none">${i18nText('prop.none', locale)}</div>`;
  }
  const order = { error: 0, warning: 1, review: 2 };
  const sorted = [...proposals].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const sevBadge = { error: 'bg-danger', warning: 'bg-warning text-dark', review: 'bg-secondary' };
  const sevKey = { error: 'prop.error', warning: 'prop.warning', review: 'prop.review' };
  return sorted.map((p, idx) => {
    const promptId = `prop-prompt-${slug(p.id || 'p')}-${idx}`;
    const files = asArray(p.affectedFiles).map((f) => `<code class="small">${escapeHtml(f)}</code>`).join(' ');
    return `
    <article class="decision-card" data-severity="${escapeHtml(p.severity)}">
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
        <div>
          <span class="decision-id">${escapeHtml(p.id)}</span>
          <h6 class="mb-1">${escapeHtml(p.title)}</h6>
        </div>
        <span class="badge ${sevBadge[p.severity] || 'bg-secondary'}" data-i18n="${sevKey[p.severity] || 'prop.review'}">${i18nText(sevKey[p.severity] || 'prop.review', locale)}</span>
      </div>
      ${p.rationale ? `<p class="small text-muted mb-2">${escapeHtml(p.rationale)}</p>` : ''}
      ${p.proposed ? `<p class="small mb-2">${escapeHtml(p.proposed)}</p>` : ''}
      ${files ? `<p class="small mb-2"><strong data-i18n="prop.affects">${i18nText('prop.affects', locale)}</strong>: ${files}</p>` : ''}
      <details>
        <summary class="small fw-semibold d-inline-flex align-items-center gap-2">
          <span data-i18n="ui.promptForAgent">${i18nText('ui.promptForAgent', locale)}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary copy-btn" data-copy-target="#${promptId}" data-i18n="ui.copyPrompt">${i18nText('ui.copyPrompt', locale)}</button>
        </summary>
        <pre class="prompt-box"><code id="${promptId}">${escapeHtml(p.agentPrompt || '')}</code></pre>
      </details>
    </article>`;
  }).join('');
}

function buildProposalsHtml(systemData, proposals, generatedAt, locale = 'es') {
  const systemName = systemData?.system?.name ?? t(locale, 'ui.designReview');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(systemName)} — ${i18nText('prop.title', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  ${themeBootScript()}
  <style>${reviewSharedStyles()}</style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(systemName)} — <span data-i18n="prop.title">${i18nText('prop.title', locale)}</span></span>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap"><span class="text-muted small">${escapeHtml(generatedAt)}</span>${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
    </div>
  </nav>
  <main class="container-xl pb-5">
    <p class="text-body-secondary" data-i18n="prop.intro">${i18nText('prop.intro', locale)}</p>
    ${renderProposalCards(proposals, locale)}
  </main>
  ${clientI18nScript(locale)}
  ${clientThemeScript()}
  ${reviewInteractionScript()}
</body>
</html>`;
}

// Compare the previous review-model.json with the freshly built one so the
// dashboard can show what changed since the last run (the loop is about
// iterating — the reviewer wants to see the effect of their last change).
function diffReviewModels(prev, current) {
  if (!prev) return null;
  const ids = (arr) => new Set(asArray(arr).map((x) => x && x.id).filter(Boolean));
  const diagKey = (d) => `${d.code}|${d.location}|${d.message}`;
  const diagSet = (arr) => new Set(asArray(arr).map(diagKey));
  const ucIds = (model) => new Set(asArray(model.boundedContexts).flatMap((bc) => asArray(bc.useCaseCatalog).map((uc) => uc.id)));

  const prevDec = ids(prev.decisions); const curDec = ids(current.decisions);
  const prevDiag = diagSet(prev.diagnostics); const curDiag = diagSet(current.diagnostics);
  const prevUc = ucIds(prev); const curUc = ucIds(current);

  const count = (set, notIn) => [...set].filter((x) => !notIn.has(x)).length;
  const diff = {
    newDecisions: count(curDec, prevDec),
    resolvedDecisions: count(prevDec, curDec),
    newDiagnostics: count(curDiag, prevDiag),
    resolvedDiagnostics: count(prevDiag, curDiag),
    newUseCases: count(curUc, prevUc),
    removedUseCases: count(prevUc, curUc),
  };
  diff.hasChanges = Object.values(diff).some((v) => v > 0);
  return diff;
}

function renderDiffBanner(diff, locale = 'es') {
  if (!diff) return '';
  const items = [];
  const add = (key, count, cls) => { if (count) items.push(`<span class="badge ${cls}">${i18nText(key, locale, { count })}</span>`); };
  add('diff.newDecisions', diff.newDecisions, 'bg-primary');
  add('diff.resolvedDecisions', diff.resolvedDecisions, 'bg-success');
  add('diff.newDiagnostics', diff.newDiagnostics, 'bg-danger');
  add('diff.resolvedDiagnostics', diff.resolvedDiagnostics, 'bg-success');
  add('diff.newUseCases', diff.newUseCases, 'bg-info text-dark');
  add('diff.removedUseCases', diff.removedUseCases, 'bg-secondary');
  const body = items.length
    ? `<div class="d-flex flex-wrap gap-2">${items.join('')}</div>`
    : `<span class="text-body-secondary" data-i18n="diff.none">${i18nText('diff.none', locale)}</span>`;
  return `<div class="alert alert-secondary mb-4">
    <div class="text-uppercase small fw-semibold mb-2" data-i18n="diff.title">${i18nText('diff.title', locale)}</div>
    ${body}
  </div>`;
}

function buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt, reviewModel, patchFile, decisionsFile, locale = 'es', extras = {}) {
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
        <div class="sys-diagram-wrap bg-body rounded border">
          <div class="sys-toolbar">
            <button class="sys-btn" data-sys-zoom="in" data-i18n-title="diagram.zoomIn" title="${i18nText('diagram.zoomIn', locale)}">+</button>
            <button class="sys-btn" data-sys-zoom="out" data-i18n-title="diagram.zoomOut" title="${i18nText('diagram.zoomOut', locale)}">&minus;</button>
            <button class="sys-btn" data-sys-zoom="fit" data-i18n="diagram.fitWidth">${i18nText('diagram.fitWidth', locale)}</button>
            <button class="sys-btn" data-sys-zoom="reset" data-i18n="diagram.reset">${i18nText('diagram.reset', locale)}</button>
          </div>
          <p class="sys-hint" data-i18n="diagram.dragHintZoom">${i18nText('diagram.dragHintZoom', locale)}</p>
          <div class="sys-diag-target" id="sys-diag-target" tabindex="0">
            <div class="mermaid">${escapeHtml(systemDiagram)}</div>
          </div>
        </div>
      </section>`
    : '';

  const descAlert = systemDesc
    ? `<div class="alert alert-secondary mb-4" style="font-size:.9rem">${escapeHtml(systemDesc)}</div>`
    : '';

  const proposalsFile = extras.proposalsFile;
  const attention = reviewModel ? systemAttentionItems(reviewModel, health) : [];
  const diagShown = reviewModel ? asArray(reviewModel.diagnostics).slice(0, 8) : [];
  const moreDiag = reviewModel ? Math.max(0, asArray(reviewModel.diagnostics).length - diagShown.length) : 0;

  const reviewIntro = reviewModel ? `
    <section class="mb-5">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <h5 class="mb-0" data-i18n="ui.decisionReview">${i18nText('ui.decisionReview', locale)}</h5>
        <div class="d-flex gap-2 flex-wrap">
          <span class="badge bg-${health.errors ? 'danger' : (health.warnings ? 'warning text-dark' : 'success')}">${i18nText('ui.errorsWarnings', locale, health)}</span>
          ${proposalsFile ? `<a href="${escapeHtml(proposalsFile)}" class="btn btn-sm btn-dark" data-i18n="ui.openProposals">${i18nText('ui.openProposals', locale)}</a>` : ''}
          ${decisionsFile ? `<a href="${escapeHtml(decisionsFile)}" class="btn btn-sm btn-outline-dark" data-i18n="ui.decisionsExplorer">${i18nText('ui.decisionsExplorer', locale)}</a>` : ''}
          ${patchFile ? `<a href="${escapeHtml(patchFile)}" class="btn btn-sm btn-outline-secondary" data-i18n="ui.patchProposals">${i18nText('ui.patchProposals', locale)}</a>` : ''}
        </div>
      </div>
      <div class="mb-4">${renderAttentionPanel(attention, locale)}</div>
      ${renderMetricTiles(systemMetrics)}
      <div class="row g-3">
        <div class="col-lg-7">
          <h6 class="mb-3" data-i18n="ui.systemDecisions">${i18nText('ui.systemDecisions', locale)}</h6>
          ${renderDecisionCards(reviewModel.systemDecisions, locale)}
        </div>
        <div class="col-lg-5" id="sec-system-diagnostics">
          <h6 class="mb-3" data-i18n="ui.validationHealth">${i18nText('ui.validationHealth', locale)}</h6>
          ${renderDiagnostics(diagShown, locale)}
          ${moreDiag && proposalsFile ? `<a href="${escapeHtml(proposalsFile)}" class="small d-inline-block mt-2">+${moreDiag} · <span data-i18n="ui.viewAll">${i18nText('ui.viewAll', locale)}</span></a>` : ''}
        </div>
      </div>
    </section>` : '';

  const sagaSection = (reviewModel && asArray(reviewModel.sagas).length) ? `
    <section class="mb-5">
      <h5 class="mb-3" data-i18n="ui.systemSagas">${i18nText('ui.systemSagas', locale)}</h5>
      ${renderSagaViews(reviewModel.sagas, locale)}
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(systemName)} — ${i18nText('ui.designReview', locale)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  ${themeBootScript()}
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    ${reviewSharedStyles()}
    .bc-card { transition: transform .15s, box-shadow .15s; }
    .bc-card:hover { transform: translateY(-3px); box-shadow: 0 6px 16px rgba(0,0,0,.45); }
    /* System Architecture (C4) diagram viewport */
    .sys-diagram-wrap {
      position: relative;
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: .5rem;
      padding: 1rem 1.25rem 1.25rem;
      min-height: 280px;
      max-height: 70vh;
      overflow: auto;
    }
    .sys-toolbar {
      display: flex; gap: .35rem; justify-content: flex-end; flex-wrap: wrap;
      position: sticky; top: 0; z-index: 2;
      background: var(--bs-body-bg); padding: .25rem 0; margin-bottom: .25rem;
    }
    .sys-btn {
      min-width: 2.1rem; padding: .25rem .55rem; font-size: .8rem; line-height: 1.2;
      color: var(--bs-body-color); background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color); border-radius: .375rem; cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .sys-btn:hover { background: var(--bs-tertiary-bg); border-color: var(--bs-secondary-color); }
    .sys-btn:active { background: var(--bs-secondary-bg); }
    .sys-hint { font-size: .78rem; color: var(--bs-secondary-color); text-align: right; margin: 0 0 .75rem; }
    .sys-diag-target { display: inline-block; transform-origin: 0 0; cursor: grab; }
    .sys-diag-target.sys-dragging { cursor: grabbing; }
    .sys-diag-target svg { display: block; max-width: none; height: auto; }
    .sys-diag-error { text-align: left; }
    .sys-diag-error .error-message {
      background: #fff3cd; border: 1px solid #ffecb5; border-radius: .4rem;
      padding: .75rem; margin-bottom: .75rem;
    }
    .sys-diag-error pre {
      background: #fff8e1; border: 1px solid #ffe082; border-radius: .4rem;
      padding: 1rem; font-size: .78rem; white-space: pre-wrap; margin: 0;
    }
    .sys-diag-error .line-no { color: var(--bs-secondary-color); user-select: none; display: inline-block; width: 3.5rem; }
    [data-bs-theme="dark"] .sys-diag-error .error-message { background: #322a0c; border-color: #5c4d12; }
    [data-bs-theme="dark"] .sys-diag-error pre { background: #2a2410; border-color: #5c4d12; color: #e8dca6; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold fs-5">${escapeHtml(systemName)} — <span data-i18n="ui.designReview">${i18nText('ui.designReview', locale)}</span></span>
      <div class="d-flex gap-3 align-items-center"><span class="text-muted small">${escapeHtml(generatedAt)}</span>${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
    </div>
  </nav>

  <div class="container-xl pb-5">
    ${descAlert}
    ${extras.diff ? renderDiffBanner(extras.diff, locale) : ''}
    ${reviewIntro}
    ${diagramSection}
    ${sagaSection}

    <section>
      <h5 class="mb-3">
        <span data-i18n="ui.boundedContexts">${i18nText('ui.boundedContexts', locale)}</span>
        <span class="badge bg-secondary ms-1">${bcCards.length}</span>
      </h5>
      <div class="row g-3">${cards}</div>
    </section>
  </div>

  <script>
    mermaid.initialize({ startOnLoad: false, theme: (window.__dslPreviewTheme === 'dark' ? 'dark' : 'default') });
    // Render saga sequence diagrams (and any .mermaid outside the system C4 diagram).
    document.querySelectorAll('.mermaid').forEach(function (el) {
      if (el.closest('#sys-diag-target')) return;
      try { mermaid.run({ nodes: [el], suppressErrors: true }); }
      catch (e) { console.warn('Saga diagram render error:', e); }
    });
    (async function() {
      var target = document.getElementById('sys-diag-target');
      if (!target) return;
      var wrap = target.closest('.sys-diagram-wrap');
      if (!wrap) return;
      var mermaidEl = target.querySelector('.mermaid');
      if (!mermaidEl) return;
      // textContent gives the decoded source (HTML entities resolved by the browser).
      var sysSource = mermaidEl.textContent.trim();
      function sysEsc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function sysNumberedSource(src) {
        return String(src || '').split('\\n').map(function(line, i) {
          return '<span class="line-no">' + String(i + 1).padStart(3, ' ') + '</span>' + sysEsc(line);
        }).join('\\n');
      }
      function showSysError(msg) {
        target.className = 'sys-diag-error';
        target.style.transform = '';
        target.innerHTML =
          '<div class="error-message">' +
          '<div class="text-warning small mb-2 fw-semibold">&#9888; <span data-i18n="diagram.syntaxError">${i18nText('diagram.syntaxError', locale)}</span></div>' +
          '<p class="small mb-1"><strong>system-diagram.mmd</strong></p>' +
          '<p class="small mb-0"><span data-i18n="diagram.renderFailed">${i18nText('diagram.renderFailed', locale)}</span> ' +
          '<span data-i18n="diagram.errorMessage">${i18nText('diagram.errorMessage', locale)}</span>: ' + sysEsc(msg) + '</p>' +
          '</div>' +
          '<div class="text-muted small mb-2 fw-semibold" data-i18n="diagram.rawSource">${i18nText('diagram.rawSource', locale)}</div>' +
          '<pre>' + sysNumberedSource(sysSource) + '</pre>';
      }
      // Render with a parse pre-check + one retry. mermaid.run() with
      // suppressErrors:true draws the "bomb" icon instead of throwing, so
      // parse() is the only reliable way to detect a bad diagram; the retry
      // absorbs the occasional race with mermaid.initialize on the experimental
      // C4 renderer.
      async function renderSysDiagram() {
        await mermaid.parse(sysSource);          // throws on syntax error
        mermaidEl.removeAttribute('data-processed');
        await mermaid.run({ nodes: [mermaidEl] });
      }
      try {
        await renderSysDiagram();
      } catch (e1) {
        console.warn('System diagram render error (will retry):', e1);
        await new Promise(function(r) { setTimeout(r, 150); });
        try {
          await renderSysDiagram();
        } catch (e2) {
          console.warn('System diagram render error:', e2);
          showSysError(e2 && e2.message ? e2.message : String(e2));
          return;
        }
      }
      // Set arrow stroke-width to 2px — C4 diagram uses inline stroke-width attributes,
      // not CSS classes, so we update them directly after render.
      var svgEl = target.querySelector('svg');
      if (svgEl) {
        svgEl.querySelectorAll('path[stroke-width="1"], line[stroke-width="1"]').forEach(function(p) {
          p.setAttribute('stroke-width', '2');
        });
      }
      var scale = 1, tx = 0, ty = 0, dragging = false, startX = 0, startY = 0;
      // Returns the viewBox width (SVG canvas size) used to set CSS width.
      function getViewW() {
        var svg = target.querySelector('svg');
        if (svg && svg.viewBox && svg.viewBox.baseVal.width > 1) return svg.viewBox.baseVal.width;
        var bcrW = svg ? svg.getBoundingClientRect().width : 0;
        return bcrW > 1 ? bcrW : 800;
      }
      // Returns { x, width } of the actual drawn content inside the SVG (via getBBox).
      // Falls back to { x:0, width: viewBoxWidth } when getBBox is unavailable.
      function getContentBounds() {
        var svg = target.querySelector('svg');
        if (svg) {
          try {
            var bb = svg.getBBox();
            if (bb.width > 1) return { x: bb.x, width: bb.width };
          } catch(e) {}
        }
        return { x: 0, width: getViewW() };
      }
      function apply() {
        var svg = target.querySelector('svg');
        if (!svg) return;
        // Width is based on the full viewBox so the SVG coordinate system scales uniformly.
        svg.style.width = Math.round(getViewW() * scale) + 'px';
        svg.style.height = 'auto';
        svg.style.maxWidth = 'none';
        target.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)';
      }
      function zoom(d) { scale = Math.min(4, Math.max(0.25, Math.round((scale + d) * 100) / 100)); apply(); }
      function reset() {
        // Scale 1:1, but offset so content left edge aligns with container.
        var cb = getContentBounds();
        scale = 1; tx = -Math.round(cb.x); ty = 0; apply();
      }
      function fit() {
        var avail = Math.max(240, wrap.clientWidth - 32);
        var cb = getContentBounds();
        // Scale to fit the actual content width (with 16px breathing room), then offset to align content left edge.
        scale = Math.min(2.5, Math.max(0.05, (avail - 16) / cb.width));
        tx = -Math.round(cb.x * scale); ty = 0; apply();
      }
      // Clamp tx/ty so at least minVis px of the diagram remains visible in the wrap.
      function clampPan() {
        var svg = target.querySelector('svg');
        if (!svg) return;
        var minVis = 80;
        var svgW = parseFloat(svg.style.width) || 200;
        var svgH = target.getBoundingClientRect().height || 200;
        var wW = wrap.clientWidth, wH = wrap.clientHeight;
        tx = Math.min(wW - minVis, Math.max(-(svgW - minVis), tx));
        ty = Math.min(wH - minVis, Math.max(-(svgH - minVis), ty));
      }
      wrap.querySelectorAll('[data-sys-zoom]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var a = btn.getAttribute('data-sys-zoom');
          if (a === 'in') zoom(0.15);
          else if (a === 'out') zoom(-0.15);
          else if (a === 'reset') reset();
          else if (a === 'fit') fit();
        });
      });
      target.addEventListener('pointerdown', function(e) {
        if (e.button !== 0) return;
        dragging = true; startX = e.clientX - tx; startY = e.clientY - ty;
        target.classList.add('sys-dragging'); target.setPointerCapture(e.pointerId);
      });
      target.addEventListener('pointermove', function(e) {
        if (!dragging) return;
        tx = e.clientX - startX; ty = e.clientY - startY;
        clampPan(); apply();
      });
      target.addEventListener('pointerup', function() { dragging = false; target.classList.remove('sys-dragging'); });
      target.addEventListener('keydown', function(e) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.15); }
        else if (e.key === '-') { e.preventDefault(); zoom(-0.15); }
        else if (e.key === '0') { e.preventDefault(); reset(); }
      });
      // Zoom on wheel only while Ctrl/Cmd is held; a plain wheel scrolls the page.
      wrap.addEventListener('wheel', function(e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        zoom(e.deltaY < 0 ? 0.1 : -0.1);
      }, { passive: false });
      requestAnimationFrame(function() { requestAnimationFrame(function() { fit(); }); });
    })();
  <\/script>
  ${clientI18nScript(locale)}
  ${clientThemeScript()}
  ${reviewInteractionScript()}
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
  ${themeBootScript()}
  <style>
    .topbar { display: none; }
    .back-bar { background: #1b1b1b; color: #ccc; padding: 8px 20px; font-size: 13px; display: flex; align-items: center; gap: 12px; }
    .back-bar a { color: #90caf9; text-decoration: none; }
    .back-bar a:hover { text-decoration: underline; }
    /* Basic dark theme for Swagger UI (no Bootstrap on this page). */
    [data-bs-theme="dark"] body { background: #1a1a1a; }
    [data-bs-theme="dark"] .swagger-ui,
    [data-bs-theme="dark"] .swagger-ui .info .title,
    [data-bs-theme="dark"] .swagger-ui .info li,
    [data-bs-theme="dark"] .swagger-ui .info p,
    [data-bs-theme="dark"] .swagger-ui .info a,
    [data-bs-theme="dark"] .swagger-ui .opblock-tag,
    [data-bs-theme="dark"] .swagger-ui .opblock .opblock-summary-description,
    [data-bs-theme="dark"] .swagger-ui .opblock .opblock-summary-path,
    [data-bs-theme="dark"] .swagger-ui table thead tr td,
    [data-bs-theme="dark"] .swagger-ui table thead tr th,
    [data-bs-theme="dark"] .swagger-ui .parameter__name,
    [data-bs-theme="dark"] .swagger-ui .parameter__type,
    [data-bs-theme="dark"] .swagger-ui .response-col_status,
    [data-bs-theme="dark"] .swagger-ui .response-col_description,
    [data-bs-theme="dark"] .swagger-ui .model,
    [data-bs-theme="dark"] .swagger-ui .model-title,
    [data-bs-theme="dark"] .swagger-ui label { color: #e0e0e0; }
    [data-bs-theme="dark"] .swagger-ui .scheme-container,
    [data-bs-theme="dark"] .swagger-ui .opblock .opblock-section-header { background: #2a2a2a; box-shadow: none; }
    [data-bs-theme="dark"] .swagger-ui section.models,
    [data-bs-theme="dark"] .swagger-ui .opblock { background: #232323; border-color: #3a3a3a; }
    [data-bs-theme="dark"] .swagger-ui .opblock .opblock-summary { border-color: #3a3a3a; }
    [data-bs-theme="dark"] .swagger-ui .model-box { background: rgba(255,255,255,.05); }
    [data-bs-theme="dark"] .swagger-ui svg:not(:root) { fill: #e0e0e0; }
  </style>
</head>
<body>
  <div class="back-bar">
    <a href="index.html">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a> &nbsp;/&nbsp; ${escapeHtml(bcName)} — <span data-i18n="nav.restApi">${i18nText('nav.restApi', locale)}</span> ${themeSwitcher(locale)}${localeSwitcher(locale)}
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"><\/script>
  ${clientI18nScript(locale)}
  ${clientThemeScript()}
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
  ${themeBootScript()}
  <style>
    body { background: var(--bs-secondary-bg); }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark mb-4" style="background:#1a1a2e">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold">${escapeHtml(bcName)} — <span data-i18n="nav.events">${i18nText('nav.events', locale)}</span></span>
      <div class="d-flex gap-2 align-items-center"><a href="index.html" class="text-white-50 text-decoration-none small">&#8592; <span data-i18n="nav.dashboard">${i18nText('nav.dashboard', locale)}</span></a>${themeSwitcher(locale)}${localeSwitcher(locale)}</div>
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
  ${clientThemeScript()}
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
        // Human-readable narrative artifacts: use case specs and Given/When/Then
        // flows. Parsed into a per-UC index so the review can show behavior in
        // plain language next to each use case.
        const specMd = await readTextIfExists(path.join(bcDir, `${bcName}-spec.md`));
        const flowsMd = await readTextIfExists(path.join(bcDir, `${bcName}-flows.md`));
        const narrative = (specMd || flowsMd) ? parseBcNarrative(specMd, flowsMd) : null;
        // All Given/When/Then scenarios in document order (including flows not
        // linked to a use case, e.g. saga handlers) for the dedicated section.
        const scenarios = extractFlowScenarios(flowsMd);

        if (bcDoc) {
          bcDoc.bc = bcDoc.bc || bcName;
          bcYamls.push(bcDoc);
          if (openApiDoc) openApiByBc.set(bcName, openApiDoc);
          if (internalApiDoc) internalApiByBc.set(bcName, internalApiDoc);
          if (asyncApiDoc) asyncApiByBc.set(bcName, asyncApiDoc);
        }

        bcArtifacts.set(bcName, { bcDir, bcDoc, openApiDoc, internalApiDoc, asyncApiDoc, narrative, scenarios });
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

      // Saga flows are cross-BC; resolved once from system.yaml + all bc.yaml docs
      // so each BC review can show its participation and the explorer/index the full flow.
      const sagas = extractSagas(systemData, bcYamls);

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
        const bcIntegrations = extractIntegrations(artifact.bcDoc, systemData);
        const bcDecisions = extractBcDecisions(artifact.bcDoc, {
          openApi: artifact.openApiDoc,
          internalApi: artifact.internalApiDoc,
          asyncApi: artifact.asyncApiDoc,
        }, bcIntegrations);
        const opIndex = indexOpenApiOperations(artifact.openApiDoc);
        const internalOpIndex = indexOpenApiOperations(artifact.internalApiDoc);
        const bcReview = {
          name: bcName,
          type: artifact.bcDoc?.type || bc.type,
          purpose: artifact.bcDoc?.description || bc.purpose || '',
          hasDesign,
          metrics: buildBcMetrics(artifact.bcDoc, bcDiagnostics),
          decisions: bcDecisions,
          useCaseCatalog: extractUseCaseCatalog(artifact.bcDoc, opIndex, internalOpIndex, artifact.narrative),
          securityMatrix: extractSecurityMatrix(artifact.bcDoc, opIndex, internalOpIndex),
          operationsMatrix: extractOperationsMatrix(artifact.bcDoc, opIndex, internalOpIndex),
          scenarios: asArray(artifact.scenarios),
          events: extractEvents(artifact.bcDoc),
          storage: extractStorageUsage(artifact.bcDoc, systemData),
          integrations: bcIntegrations,
          sagas,
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
        sagas,
        traceability: buildTraceabilityIndex(reviewBcs, sagas),
        diagnostics,
      };

      // Diff against the previous run (if any) so the dashboard can show what
      // changed since the last review — iteration is the whole point of preview.
      let diff = null;
      try {
        const prevPath = path.join(reviewDir, 'review-model.json');
        if (await fs.pathExists(prevPath)) {
          const prevModel = JSON.parse(await fs.readFile(prevPath, 'utf8'));
          diff = diffReviewModels(prevModel, reviewModel);
        }
      } catch { /* ignore unreadable/legacy previous model */ }

      // Proposals are computed once and surfaced both as the agent-facing YAML
      // and as an in-browser, prioritized HTML panel.
      const proposals = buildPatchProposals(reviewModel);

      let patchFile = null;
      if (opts.includePatches) {
        patchFile = 'patch-proposals.yaml';
        await fs.writeFile(path.join(reviewDir, patchFile), yaml.dump({ proposals }, { lineWidth: 120 }), 'utf8');
      }

      if (opts.format === 'json' || opts.format === 'all') {
        await fs.writeFile(path.join(reviewDir, 'review-model.json'), JSON.stringify(reviewModel, null, 2), 'utf8');
      } else if (opts.format !== 'html') {
        spinner.fail(chalk.red(t(locale, 'cli.unsupportedFormat', { format: opts.format })));
        process.exit(1);
      }

      const generatedAt = new Date().toLocaleString();

      // Global decision explorer (aggregates use cases, security, sagas, events across BCs)
      const decisionsFile = 'decisions.html';
      await fs.writeFile(
        path.join(reviewDir, decisionsFile),
        buildDecisionsExplorerHtml(systemData, reviewModel, generatedAt, locale),
        'utf8'
      );

      // Iteration proposals page (open decisions, security gaps, diagnostics).
      const proposalsFile = 'proposals.html';
      await fs.writeFile(
        path.join(reviewDir, proposalsFile),
        buildProposalsHtml(systemData, proposals, generatedAt, locale),
        'utf8'
      );

      // Generate index.html
      const indexHtml = buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt, reviewModel, patchFile, decisionsFile, locale, { diff, proposalsFile });
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
