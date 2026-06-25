// Narrative extraction for the DSL preview "mesa de revisión".
//
// The tactical design produces two human-readable artifacts that the preview
// historically ignored:
//   - {bc}-spec.md   → use case specifications (preconditions, main flow,
//                      exception flows, postconditions) titled `### UC-XXX-NNN: Name`
//   - {bc}-flows.md  → Given/When/Then scenarios titled `### FL-XXX-NNN: ...`,
//                      plus a `UC → Flow` coverage matrix table.
//
// This module parses both into a per-use-case narrative so the review page can
// show the behavior in plain language next to each use case, instead of only
// codes (rule ids, error codes) in dense tables.
//
// It is intentionally dependency-free (no markdown library) so the CLI keeps
// working offline with no build step. The renderer covers the small subset of
// markdown these artifacts actually use.

const HEADING_RE = /^#{2,6}\s+([A-Z]{2,}-[A-Z]{2,}-\d+|UC-[A-Z0-9]+-\d+|FL-[A-Z0-9]+-\d+)\s*[:\-—]?\s*(.*)$/;
const ID_IN_TEXT_RE = /\b((?:UC|FL)-[A-Z0-9]+-\d+)\b/;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal, safe markdown → HTML renderer for spec/flow section bodies.
// Handles: fenced code blocks, blockquotes, ordered/unordered lists, GFM
// tables, headings (h4-h6), paragraphs, and inline bold/italic/code.
function renderMarkdown(md) {
  if (!md || !String(md).trim()) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushInline = (text) => {
    // text is already HTML-escaped; apply inline emphasis/code on top.
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) { i++; continue; }

    // Fenced code block
    const fence = trimmed.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre class="narrative-code"><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // GFM table: header row followed by a separator row of dashes/pipes.
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = splitRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${flushInline(escapeHtml(c))}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${flushInline(escapeHtml(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<div class="table-responsive"><table class="table table-sm narrative-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote (group consecutive `>` lines)
    if (trimmed.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="narrative-quote">${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol>${buf.map((t) => `<li>${flushInline(escapeHtml(t))}</li>`).join('')}</ol>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && lines[i].trim()) {
        buf.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(`<ul>${buf.map((t) => `<li>${flushInline(escapeHtml(t))}</li>`).join('')}</ul>`);
      continue;
    }

    // Sub-heading inside a section body
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h6 class="narrative-subheading">${flushInline(escapeHtml(h[2]))}</h6>`);
      i++;
      continue;
    }

    // Horizontal rule — skip (section boundaries handled by the splitter)
    if (/^---+$/.test(trimmed)) { i++; continue; }

    // Paragraph (gather until blank / structural line)
    const buf = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || next.startsWith('>') || next.startsWith('```')
        || /^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)
        || /^#{1,6}\s+/.test(next) || /^---+$/.test(next)) break;
      buf.push(next);
      i++;
    }
    out.push(`<p>${flushInline(escapeHtml(buf.join(' ')))}</p>`);
  }

  return out.join('\n');
}

function splitRow(row) {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// Split a markdown document into sections keyed by the design id in their
// heading (e.g. `### UC-CAT-001: CreateCategory`). Returns ordered entries with
// id, title and the raw markdown body up to the next id heading.
function splitSectionsById(md) {
  const sections = [];
  if (!md) return sections;
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push(current);
      current = { id: m[1], title: (m[2] || '').trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ id: s.id, title: s.title, body: s.body.join('\n').trim() }));
}

// Parse the `UC → Flow` coverage matrix table at the top of a flows.md file.
// Returns Map<ucId, [flowId, ...]>.
function parseCoverageMatrix(md) {
  const coverage = new Map();
  if (!md) return coverage;
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = splitRow(line.trim());
    const ucCell = cells.find((c) => /^UC-[A-Z0-9]+-\d+$/.test(c));
    if (!ucCell) continue;
    const flowIds = [];
    for (const c of cells) {
      const matches = c.match(/FL-[A-Z0-9]+-\d+/g);
      if (matches) flowIds.push(...matches);
    }
    if (flowIds.length) coverage.set(ucCell, flowIds);
  }
  return coverage;
}

// Build the per-use-case narrative index for one bounded context.
//
//   parseBcNarrative(specMd, flowsMd) → Map<ucId, {
//     spec:  { title, html } | null,
//     flows: [ { id, title, html } ]
//   }>
//
// Flows are attached to a use case via the coverage matrix when present; as a
// fallback, a flow is linked when its title starts with the use case name.
function parseBcNarrative(specMd, flowsMd) {
  const index = new Map();

  const specSections = splitSectionsById(specMd).filter((s) => /^UC-/.test(s.id));
  for (const s of specSections) {
    index.set(s.id, { spec: { title: s.title, html: renderMarkdown(s.body) }, flows: [] });
  }

  const flowSections = splitSectionsById(flowsMd).filter((s) => /^FL-/.test(s.id));
  const flowsById = new Map(flowSections.map((s) => [s.id, s]));
  const coverage = parseCoverageMatrix(flowsMd);

  const ensure = (ucId) => {
    if (!index.has(ucId)) index.set(ucId, { spec: null, flows: [] });
    return index.get(ucId);
  };

  const linkedFlowIds = new Set();
  for (const [ucId, flowIds] of coverage.entries()) {
    const entry = ensure(ucId);
    for (const fid of flowIds) {
      const flow = flowsById.get(fid);
      if (!flow) continue;
      entry.flows.push({ id: flow.id, title: flow.title, html: renderMarkdown(flow.body) });
      linkedFlowIds.add(fid);
    }
  }

  // Fallback: attach unlinked flows by name prefix match (e.g. "CreateCategory —
  // happy path" → UC whose name is CreateCategory).
  if (specSections.length) {
    for (const flow of flowSections) {
      if (linkedFlowIds.has(flow.id)) continue;
      const lead = flow.title.split(/[—\-:]/)[0].trim().toLowerCase();
      const match = specSections.find((s) => s.title.trim().toLowerCase() === lead);
      if (match) {
        ensure(match.id).flows.push({ id: flow.id, title: flow.title, html: renderMarkdown(flow.body) });
      }
    }
  }

  return index;
}

module.exports = {
  parseBcNarrative,
  splitSectionsById,
  parseCoverageMatrix,
  renderMarkdown,
  ID_IN_TEXT_RE,
};
