function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToolDocPath(toolKey) {
  return `/tool-docs/${encodeURIComponent(toolKey)}.html`;
}

function formatDefaultValue(value) {
  if (value === '' || value == null) return '<span class="tool-docs-muted">—</span>';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value);
}

function renderParameterRows(parameters = []) {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return '<tr><td colspan="5" class="tool-docs-muted">This tool does not declare parameters.</td></tr>';
  }

  return parameters.map((param) => {
    const options = Array.isArray(param.options) && param.options.length
      ? escapeHtml(param.options.join(', '))
      : '<span class="tool-docs-muted">—</span>';

    return `
      <tr>
        <td>${escapeHtml(param.name)}</td>
        <td>${escapeHtml(param.type || '')}</td>
        <td>${escapeHtml(param.description || '')}</td>
        <td>${formatDefaultValue(param.defaultValue)}</td>
        <td>${options}</td>
      </tr>`;
  }).join('');
}

function renderToolNav(specs = [], currentKey = null) {
  return specs.map((spec) => {
    const isCurrent = spec.key === currentKey;
    return `<a class="tool-docs-nav-link${isCurrent ? ' is-current' : ''}" href="${getToolDocPath(spec.key)}">${escapeHtml(spec.name)}</a>`;
  }).join('');
}

function renderLayout({ title, content, specs = [], currentKey = null }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/tool-docs/tool-docs.css" />
</head>
<body>
  <div class="tool-docs-shell">
    <aside class="tool-docs-sidebar">
      <a class="tool-docs-brand" href="/tool-docs/index.html">Spatial Workbench</a>
      <nav class="tool-docs-nav" aria-label="Tool docs navigation">
        ${renderToolNav(specs, currentKey)}
      </nav>
    </aside>
    <main class="tool-docs-main">
      ${content}
    </main>
  </div>
</body>
</html>`;
}

function renderToolDocPage(spec, specs = []) {
  const description = spec.description || 'No description is available for this tool yet.';
  const parameters = Array.isArray(spec.parameters) ? spec.parameters : [];
  const content = `
    <header class="tool-docs-header">
      <div class="tool-docs-kicker">Tool reference</div>
      <h1>${escapeHtml(spec.name)}</h1>
      <p class="tool-docs-description">${escapeHtml(description)}</p>
      <div class="tool-docs-meta-grid">
        <div class="tool-docs-meta-card">
          <div class="tool-docs-meta-label">Key</div>
          <div class="tool-docs-meta-value"><code>${escapeHtml(spec.key)}</code></div>
        </div>
      </div>
    </header>

    <section class="tool-docs-section">
      <div class="tool-docs-section-label">Parameters</div>
      <table class="tool-docs-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Description</th>
            <th>Default</th>
            <th>Options</th>
          </tr>
        </thead>
        <tbody>
          ${renderParameterRows(parameters)}
        </tbody>
      </table>
    </section>

    <section class="tool-docs-section">
      <div class="tool-docs-section-label">Spec JSON</div>
      <pre class="tool-docs-code"><code>${escapeHtml(JSON.stringify(spec, null, 2))}</code></pre>
    </section>`;

  return renderLayout({
    title: `${spec.name} · Spatial Workbench Docs`,
    content,
    specs,
    currentKey: spec.key,
  });
}

function renderDocsIndex(specs = []) {
  const cards = specs.map((spec) => `
    <article class="tool-docs-card">
      <div class="tool-docs-card-head">
        <div>
          <div class="tool-docs-card-title">${escapeHtml(spec.name)}</div>
          <div class="tool-docs-card-key"><code>${escapeHtml(spec.key)}</code></div>
        </div>
      </div>
      <p class="tool-docs-card-description">${escapeHtml(spec.description || 'No description is available for this tool yet.')}</p>
      <a class="tool-docs-card-link" href="${getToolDocPath(spec.key)}">Open tool page</a>
    </article>`).join('');

  const content = `
    <header class="tool-docs-header">
      <div class="tool-docs-kicker">Reference</div>
      <h1>Tool docs</h1>
    </header>

    <section class="tool-docs-section">
      <div class="tool-docs-section-label">Available tools</div>
      <div class="tool-docs-card-grid">${cards}</div>
    </section>`;

  return renderLayout({
    title: 'Spatial Workbench Tool Docs',
    content,
    specs,
  });
}

module.exports = {
  escapeHtml,
  getToolDocPath,
  renderDocsIndex,
  renderToolDocPage,
};
