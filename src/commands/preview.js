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
        }

        bcCards.push({
          name: bcName,
          type: bc.type,
          purpose: bc.purpose,
          aggregates: bc.aggregates,
          hasDesign,
          openApiFile,
          asyncApiFile,
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
