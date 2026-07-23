(function () {
  const baseUrl = document.getElementById('baseUrl');
  const catalog = document.getElementById('toolCatalog');
  const status = document.getElementById('catalogStatus');
  const toolCount = document.getElementById('toolCount');

  if (baseUrl) baseUrl.textContent = window.location.origin;

  function copyText(value, button) {
    navigator.clipboard.writeText(value).then(() => {
      const label = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = label; }, 1400);
    }).catch(() => { button.textContent = 'Copy failed'; });
  }

  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', () => copyText(document.getElementById(button.dataset.copyTarget).textContent, button));
  });
  document.querySelectorAll('[data-copy-code]').forEach((button) => {
    button.addEventListener('click', () => copyText(document.getElementById(button.dataset.copyCode).textContent, button));
  });

  function renderTool(tool) {
    const params = (tool.parameters || []).map((param) => `<li><code>${param.name}</code><span>${param.type}${param.defaultValue !== undefined && param.defaultValue !== '' ? ` · default: ${param.defaultValue}` : ''}</span></li>`).join('');
    return `<article class="tool-card"><div class="tool-card-top"><span class="state-mode">${tool.stateMode === 'featureCollection' ? 'Feature collection' : 'Layers'}</span><code>${tool.key}</code></div><h3>${tool.name}</h3><p>${tool.description}</p><details><summary>${tool.parameters.length} parameter${tool.parameters.length === 1 ? '' : 's'}</summary><ul>${params}</ul></details></article>`;
  }

  fetch('/api/run').then((response) => {
    if (!response.ok) throw new Error('Catalog unavailable');
    return response.json();
  }).then((data) => {
    const tools = data.supportedTools || [];
    catalog.innerHTML = tools.map(renderTool).join('');
    status.textContent = `${tools.length} tools are available from this deployment.`;
    toolCount.textContent = tools.length;
  }).catch(() => {
    status.textContent = 'The live catalog could not be loaded. Try the raw discovery endpoint.';
  });
}());
