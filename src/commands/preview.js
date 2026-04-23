'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const yaml = require('js-yaml');
const open = require('open');

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

function renderSchemaTable(schema, allSchemas) {
  if (!schema) return '<p class="text-muted small mb-0">No schema available.</p>';

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
        <tr><th style="width:28%">Field</th><th style="width:16%">Type</th><th>Description</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Channel card (AsyncAPI) ───────────────────────────────────────────────────

function buildChannelCard(channelName, channelDef, messages, schemas) {
  const op = channelDef.publish ? 'publish' : 'subscribe';
  const opDef = channelDef[op] || {};

  const msgRef = opDef.message && opDef.message.$ref;
  const msgKey = msgRef ? msgRef.split('/').pop() : null;
  const msgDef = msgKey ? (messages[msgKey] || opDef.message || {}) : (opDef.message || {});

  const payloadRef = msgDef.payload && msgDef.payload.$ref;
  const schemaKey = payloadRef ? payloadRef.split('/').pop() : null;
  const schema = schemaKey ? (schemas[schemaKey] || {}) : (msgDef.payload || {});

  const opLabel = op === 'publish' ? '&#11014; PUBLISH' : '&#11015; SUBSCRIBE';
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
        <p class="mb-1 small"><strong>Message:</strong> ${escapeHtml(msgDef.name || msgKey || 'anonymous')}</p>
        ${msgSummary}
        ${renderSchemaTable(schema, schemas)}
      </div>
    </div>`;
}

// ─── Diagram classification ─────────────────────────────────────────────────────
// Groups .mmd files by type using deterministic suffix matching.
// Returns: { overview, domainModel, states: [{title,content}], sequences: [{title,content}] }

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
    const content = raw.replace(/\\n/g, ' ');
    const base = file.replace(/\.mmd$/, '');

    if (base === `${bcName}-diagram`) {
      result.overview = content;
    } else if (base.endsWith('-domain-model')) {
      result.domainModel = content;
    } else if (base.endsWith('-states')) {
      result.states.push({ title: humanizeDiagramName(file, bcName), content });
    } else if (base.endsWith('-seq')) {
      result.sequences.push({ title: humanizeDiagramName(file, bcName), content });
    }
  }

  return result;
}

// ─── Design page (diagrams) ───────────────────────────────────────────────────

function buildDesignHtml(bcName, diagramGroups, openApiFile, asyncApiFile) {
  const tabs = [];
  const panes = [];
  const diagramSources = []; // collected in order: { id, source, isSeq }

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

  function diagramPlaceholder(source, isSeq) {
    const id = `diag-${diagIdx++}`;
    diagramSources.push({ id, source, isSeq });
    const wrapClass = isSeq ? 'diagram-wrap seq-wrap' : 'diagram-wrap';
    return `<div class="${wrapClass}"><div id="${id}" class="diag-target"></div></div>`;
  }

  if (diagramGroups.overview) {
    addTab('overview', 'Overview', diagramPlaceholder(diagramGroups.overview, false));
  }
  if (diagramGroups.domainModel) {
    addTab('domain', 'Domain Model', diagramPlaceholder(diagramGroups.domainModel, false));
  }
  if (diagramGroups.states.length) {
    const html = diagramGroups.states
      .map((d) => `<h6 class="diagram-title">${escapeHtml(d.title)}</h6>${diagramPlaceholder(d.content, false)}`)
      .join('');
    addTab('states', `States <span class="badge bg-secondary ms-1">${diagramGroups.states.length}</span>`, html);
  }
  if (diagramGroups.sequences.length) {
    const html = diagramGroups.sequences
      .map((d) => `<h6 class="diagram-title">${escapeHtml(d.title)}</h6>${diagramPlaceholder(d.content, true)}`)
      .join('');
    addTab('seq', `Sequences <span class="badge bg-secondary ms-1">${diagramGroups.sequences.length}</span>`, html);
  }

  if (!tabs.length) {
    return null;
  }

  const apiLinks = [
    openApiFile ? `<a href="${escapeHtml(openApiFile)}" class="btn btn-sm btn-outline-success">REST API</a>` : '',
    asyncApiFile ? `<a href="${escapeHtml(asyncApiFile)}" class="btn btn-sm btn-outline-primary">Events</a>` : '',
  ].filter(Boolean).join('');

  // Diagram sources as a JS literal — JSON.stringify handles all escaping
  const diagramsJs = `const DIAGRAMS = ${JSON.stringify(diagramSources)};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcName)} — Design</title>
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
    }
    .seq-wrap { overflow-x: auto; text-align: left; }
    .diag-target { display: inline-block; max-width: 100%; }
    .seq-wrap .diag-target { display: block; min-width: 600px; }
    .diag-error pre {
      background: #fff8e1; border: 1px solid #ffe082; border-radius: .4rem;
      padding: 1rem; font-size: .78rem; text-align: left; white-space: pre-wrap; margin: 0;
    }
    .diagram-title { color: #495057; font-size: .85rem; font-weight: 600; margin-bottom: .5rem; text-transform: uppercase; letter-spacing: .04em; }
    .nav-tabs .nav-link { font-size: .9rem; }
    .loading-spinner { color: #adb5bd; font-size: .85rem; padding: 2rem; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; Dashboard</a>
        <span class="navbar-brand fw-bold mb-0">${escapeHtml(bcName)} — Design</span>
      </div>
      <div class="d-flex gap-2">${apiLinks}</div>
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
  <script>
    ${diagramsJs}
    mermaid.initialize({ theme: 'default' });

    const rendered = new Set();

    async function renderDiagram({ id, source }) {
      if (rendered.has(id)) return;
      rendered.add(id);
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '<span class="loading-spinner">Rendering\u2026</span>';
      try {
        const { svg } = await mermaid.render('svg-' + id, source);
        el.innerHTML = svg;
      } catch (err) {
        el.className = 'diag-error';
        el.innerHTML =
          '<div class="text-warning small mb-2 fw-semibold">&#9888; Diagram syntax error \u2014 raw source:</div>' +
          '<pre>' + source.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>';
      }
    }

    // Render all diagrams in visible tab pane on load
    async function renderVisible() {
      for (const d of DIAGRAMS) {
        const el = document.getElementById(d.id);
        if (el && el.offsetParent !== null) await renderDiagram(d);
      }
    }

    // Re-render when a tab becomes active
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach((btn) => {
      btn.addEventListener('shown.bs.tab', () => renderVisible());
    });

    window.addEventListener('load', renderVisible);
  <\/script>
</body>
</html>`;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt) {
  const systemName = systemData?.system?.name ?? 'Design Review';
  const systemDesc = systemData?.system?.description ?? '';

  const typeBadgeClass = { core: 'primary', supporting: 'purple', generic: 'secondary' };

  const cards = bcCards.map((bc) => {
    const badgeClass = typeBadgeClass[bc.type] || 'secondary';
    const aggregateList = bc.aggregates?.length
      ? `<p class="small mb-2"><strong>Aggregates:</strong> ${bc.aggregates.map((a) => escapeHtml(a.name)).join(', ')}</p>`
      : '';

    let footer;
    if (bc.hasDesign) {
      const links = [
        bc.designFile ? `<a href="${escapeHtml(bc.designFile)}" class="btn btn-sm btn-outline-dark">Diagrams</a>` : '',
        bc.openApiFile ? `<a href="${escapeHtml(bc.openApiFile)}" class="btn btn-sm btn-outline-success">REST API</a>` : '',
        bc.asyncApiFile ? `<a href="${escapeHtml(bc.asyncApiFile)}" class="btn btn-sm btn-outline-primary">Events</a>` : '',
      ].filter(Boolean);
      footer = links.length
        ? `<div class="d-flex gap-2 flex-wrap">${links.join('')}</div>`
        : '<span class="text-muted small">Designed — no API contracts</span>';
    } else {
      footer = '<span class="badge bg-warning text-dark">Pending tactical design</span>';
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
        <h5 class="mb-3">System Architecture</h5>
        <div class="bg-white rounded border p-4 overflow-auto">
          <div class="mermaid">${escapeHtml(systemDiagram)}</div>
        </div>
      </section>`
    : '';

  const descAlert = systemDesc
    ? `<div class="alert alert-secondary mb-4" style="font-size:.9rem">${escapeHtml(systemDesc)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(systemName)} — Design Review</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    body { background: #f5f6f8; }
    .bc-card { transition: transform .15s, box-shadow .15s; }
    .bc-card:hover { transform: translateY(-3px); box-shadow: 0 6px 16px rgba(0,0,0,.12); }
    .bg-purple { background-color: #6f42c1 !important; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold fs-5">${escapeHtml(systemName)} — Design Review</span>
      <span class="text-muted small">${escapeHtml(generatedAt)}</span>
    </div>
  </nav>

  <div class="container-xl pb-5">
    ${descAlert}
    ${diagramSection}

    <section>
      <h5 class="mb-3">
        Bounded Contexts
        <span class="badge bg-secondary ms-1">${bcCards.length}</span>
      </h5>
      <div class="row g-3">${cards}</div>
    </section>
  </div>

  <script>mermaid.initialize({ startOnLoad: true, theme: 'default' });<\/script>
</body>
</html>`;
}

function buildOpenApiHtml(bcName, spec) {
  const derefSpec = dereferenceSpec(spec);
  return `<!DOCTYPE html>
<html lang="en">
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
    <a href="index.html">&#8592; Dashboard</a> &nbsp;/&nbsp; ${escapeHtml(bcName)} — REST API
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"><\/script>
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

function buildAsyncApiHtml(bcName, spec) {
  const channels = spec.channels || {};
  const messages = (spec.components || {}).messages || {};
  const schemas = (spec.components || {}).schemas || {};
  const info = spec.info || {};

  const channelCount = Object.keys(channels).length;
  const channelCards = Object.entries(channels)
    .map(([name, def]) => buildChannelCard(name, def, messages, schemas))
    .join('');

  const infoDesc = info.description
    ? `<span class="text-muted small ms-2">${escapeHtml(info.description)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bcName)} — Events</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #f5f6f8; }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark mb-4" style="background:#1a1a2e">
    <div class="container-xl d-flex justify-content-between align-items-center">
      <span class="navbar-brand fw-bold">${escapeHtml(bcName)} — Events</span>
      <a href="index.html" class="text-white-50 text-decoration-none small">&#8592; Dashboard</a>
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
        Channels
        <span class="badge bg-secondary ms-1">${channelCount}</span>
      </h5>
      <span class="badge bg-success">&#11014; PUBLISH — BC emits</span>
      <span class="badge bg-primary">&#11015; SUBSCRIBE — BC receives</span>
    </div>

    ${channelCards}
  </div>
</body>
</html>`;
}

// ─── Command registration ─────────────────────────────────────────────────────

function registerPreview(program) {
  program
    .command('preview [arch-path]')
    .description('Generate visual review of design artifacts and open in browser')
    .action(async (archPathArg) => {
      const archPath = archPathArg
        ? path.resolve(archPathArg)
        : path.join(process.cwd(), 'arch');

      if (!(await fs.pathExists(archPath))) {
        console.error(chalk.red(`  ERROR  arch directory not found: ${archPath}`));
        process.exit(1);
      }

      const spinner = ora('Reading design artifacts...').start();

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

      const reviewDir = path.join(archPath, 'review');
      await fs.ensureDir(reviewDir);

      // Generate viewer files per BC
      spinner.text = 'Generating viewer files...';
      const bcCards = [];

      for (const bc of bcDefinitions) {
        const bcName = bc.name;
        const bcDir = path.join(archPath, bcName);
        const hasDesign = await fs.pathExists(path.join(bcDir, `${bcName}.yaml`));
        let openApiFile = null;
        let asyncApiFile = null;
        let designFile = null;

        if (hasDesign) {
          const openApiPath = path.join(bcDir, `${bcName}-open-api.yaml`);
          if (await fs.pathExists(openApiPath)) {
            const spec = yaml.load(await fs.readFile(openApiPath, 'utf8'));
            openApiFile = `${bcName}-openapi.html`;
            await fs.writeFile(path.join(reviewDir, openApiFile), buildOpenApiHtml(bcName, spec), 'utf8');
          }

          const asyncApiPath = path.join(bcDir, `${bcName}-async-api.yaml`);
          if (await fs.pathExists(asyncApiPath)) {
            const spec = yaml.load(await fs.readFile(asyncApiPath, 'utf8'));
            asyncApiFile = `${bcName}-asyncapi.html`;
            await fs.writeFile(path.join(reviewDir, asyncApiFile), buildAsyncApiHtml(bcName, spec), 'utf8');
          }

          const diagramGroups = await classifyDiagrams(bcDir, bcName);
          const designHtml = buildDesignHtml(bcName, diagramGroups, openApiFile, asyncApiFile);
          if (designHtml) {
            designFile = `${bcName}-design.html`;
            await fs.writeFile(path.join(reviewDir, designFile), designHtml, 'utf8');
          }
        }

        bcCards.push({
          name: bcName,
          type: bc.type,
          purpose: bc.purpose,
          aggregates: bc.aggregates,
          hasDesign,
          openApiFile,
          asyncApiFile,
          designFile,
        });
      }

      // Generate index.html
      const generatedAt = new Date().toLocaleString();
      const indexHtml = buildIndexHtml(systemData, bcCards, systemDiagram, generatedAt);
      const indexPath = path.join(reviewDir, 'index.html');
      await fs.writeFile(indexPath, indexHtml, 'utf8');

      spinner.succeed(chalk.green(`Review generated → ${reviewDir}`));

      try {
        await open(indexPath);
        console.log(chalk.blue('  Opened in default browser.'));
      } catch {
        console.log(chalk.yellow('  Could not open browser automatically.'));
        console.log(chalk.white(`  Open manually: ${indexPath}`));
      }
    });
}

module.exports = { registerPreview };
