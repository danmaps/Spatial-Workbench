(function () {
  if (typeof document === 'undefined') return;

  const host = document.getElementById('compositionHost');
  const compactBtn = document.getElementById('layoutCompactBtn');
  const workspaceBtn = document.getElementById('layoutWorkspaceBtn');
  const simulateStreamBtn = document.getElementById('simulateStreamBtn');
  const exportOutputBtn = document.getElementById('exportOutputBtn');
  const openuiPre = document.getElementById('openuiExpressionPre');
  const revisionBadge = document.getElementById('revisionBadge');

  if (!host) return;

  const state = {
    stateRevision: 1,
    streamComplete: true,
    layout: 'compact',
    expressions: {},
    layers: [],
    added: [],
    selection: {
      activeLayerId: 'study-sites',
      selectedLayerIds: ['study-sites'],
      selectedFeaturesByLayerId: {
        'study-sites': ['study-sites-1', 'study-sites-2'],
      },
      targetScope: 'selection',
    },
    drafts: {
      BufferTool: {
        'Input Layer': 'study-sites',
        Distance: 500,
        Units: 'meters',
        targetScope: 'selection',
      },
    },
    lastReceipt: null,
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function bumpRevision() {
    state.stateRevision += 1;
    if (revisionBadge) {
      revisionBadge.textContent = `Rev #${state.stateRevision}`;
    }
  }

  function getSelectedIds(layerId) {
    return state.selection.selectedFeaturesByLayerId[layerId] || [];
  }

  function triggerDownload(artifact) {
    if (!artifact) return;
    const blob = new Blob([artifact.data || ''], { type: artifact.mimeType || 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = artifact.filename || 'export.geojson';
    link.click();
    URL.revokeObjectURL(url);
  }

  function render() {
    const exprKey = !state.streamComplete ? 'streamingPartial' : state.layout;
    if (openuiPre) {
      openuiPre.textContent = state.expressions[exprKey] || '';
    }
    if (revisionBadge) {
      revisionBadge.textContent = `Rev #${state.stateRevision}`;
    }

    const activeLayer = state.layers.find((l) => l.id === state.selection.activeLayerId) || state.layers[0];
    const features = activeLayer?.geojson?.features || [];
    const selectedIds = getSelectedIds(activeLayer?.id);
    const draft = state.drafts.BufferTool;
    const scopeEmptyInvalid = state.selection.targetScope === 'selection' && selectedIds.length === 0;
    const distanceNum = Number(draft.Distance);
    const distanceInvalid = !Number.isFinite(distanceNum) || distanceNum <= 0;
    const canExecute = state.streamComplete && !scopeEmptyInvalid && !distanceInvalid;

    const primaryLayer = state.layers[state.layers.length - 1] || activeLayer;
    const primaryFeatures = primaryLayer?.geojson?.features || [];

    const layerInputHtml = `
      <section class="swb-component swb-layer-input" data-component-type="LayerInput">
        <header class="swb-component-header">
          <div>
            <span class="swb-eyebrow">Input Layer</span>
            <h3 class="swb-component-title">Input Layer</h3>
          </div>
          <span class="swb-badge ${!state.streamComplete ? '' : (scopeEmptyInvalid ? 'swb-badge-danger' : '')}">
            ${!state.streamComplete ? 'Streaming…' : (scopeEmptyInvalid ? 'Needs attention' : 'Draft')}
          </span>
        </header>
        <div class="swb-component-body">
          <div class="swb-field-group">
            <label class="swb-label" for="demo-layer-select">Source layer</label>
            <select id="demo-layer-select" class="swb-select" ${!state.streamComplete ? 'disabled' : ''}>
              ${state.layers
                .map(
                  (l) =>
                    `<option value="${escapeHtml(l.id)}" ${l.id === draft['Input Layer'] ? 'selected' : ''}>${escapeHtml(l.name)} (${(l.geojson?.features || []).length})</option>`
                )
                .join('')}
            </select>
          </div>
          <fieldset class="swb-scope-fieldset" ${!state.streamComplete ? 'disabled' : ''}>
            <legend class="swb-label">Analysis scope</legend>
            <div class="swb-scope-options">
              <label class="swb-radio-label" for="demo-scope-layer">
                <input type="radio" id="demo-scope-layer" name="demo-scope" value="layer" ${state.selection.targetScope === 'layer' ? 'checked' : ''} />
                <span>Whole layer (${features.length})</span>
              </label>
              <label class="swb-radio-label" for="demo-scope-selection">
                <input type="radio" id="demo-scope-selection" name="demo-scope" value="selection" ${state.selection.targetScope === 'selection' ? 'checked' : ''} />
                <span>Selected features (${selectedIds.length})</span>
              </label>
            </div>
          </fieldset>
          ${scopeEmptyInvalid ? '<div class="swb-validation-banner" role="alert">No selected features in the chosen layer.</div>' : ''}
        </div>
      </section>
    `;

    const selectionHtml = `
      <section class="swb-component swb-spatial-selection" data-component-type="SpatialSelection">
        <header class="swb-component-header">
          <div>
            <span class="swb-eyebrow">Spatial Selection</span>
            <h3 class="swb-component-title">${escapeHtml(activeLayer?.name || 'Study Sites')}</h3>
          </div>
          <span class="swb-badge">${selectedIds.length} of ${features.length} selected</span>
        </header>
        <div class="swb-component-body">
          <ul class="swb-selection-list">
            ${features
              .map((feat, idx) => {
                const fId = feat?.properties?.__id || feat?.id || `feat-${idx + 1}`;
                const checked = selectedIds.includes(fId);
                return `
                  <li class="swb-selection-item">
                    <label class="swb-checkbox-label" for="demo-feat-${escapeHtml(fId)}">
                      <input type="checkbox" id="demo-feat-${escapeHtml(fId)}" class="demo-feat-cb" data-feature-id="${escapeHtml(fId)}" ${checked ? 'checked' : ''} ${!state.streamComplete ? 'disabled' : ''} />
                      <span>${escapeHtml(feat?.properties?.name || fId)}</span>
                      <span class="swb-feature-meta"><code>${escapeHtml(fId)}</code></span>
                    </label>
                  </li>
                `;
              })
              .join('')}
          </ul>
        </div>
      </section>
    `;

    const paramsHtml = `
      <section class="swb-component swb-tool-parameters" data-component-type="ToolParameters">
        <header class="swb-component-header">
          <div>
            <span class="swb-eyebrow">Tool Parameters · <code>BufferTool</code></span>
            <h3 class="swb-component-title">Buffer</h3>
          </div>
          <span class="swb-badge ${!state.streamComplete ? '' : (canExecute ? '' : 'swb-badge-danger')}">
            ${!state.streamComplete ? 'Streaming…' : (canExecute ? 'Draft' : 'Needs attention')}
          </span>
        </header>
        <div class="swb-component-body">
          <form id="demoParamsForm" novalidate>
            <div class="swb-field-group">
              <label class="swb-label" for="demo-distance">Distance *</label>
              <input type="number" id="demo-distance" class="swb-input" value="${escapeHtml(draft.Distance)}" step="any" ${!state.streamComplete ? 'disabled' : ''} />
            </div>
            <div class="swb-field-group">
              <label class="swb-label" for="demo-units">Units *</label>
              <select id="demo-units" class="swb-select" ${!state.streamComplete ? 'disabled' : ''}>
                ${['feet', 'meters', 'miles', 'kilometers', 'degrees']
                  .map((u) => `<option value="${u}" ${u === draft.Units ? 'selected' : ''}>${u}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="swb-assumptions-bar">
              <span><strong>CRS:</strong> <code>EPSG:4326</code> (longitude,latitude)</span>
              <span><strong>Engine:</strong> <code>@turf/turf</code> (not-survey-grade)</span>
            </div>
            <div class="swb-form-actions">
              <button type="submit" class="swb-btn swb-btn-primary" ${canExecute ? '' : 'disabled aria-disabled="true"'}>
                Run Buffer
              </button>
              <span class="swb-meta-note">Rev #${state.stateRevision}</span>
            </div>
          </form>
        </div>
      </section>
    `;

    const resultHtml = `
      <section class="swb-component swb-spatial-result" data-component-type="SpatialResult">
        <header class="swb-component-header">
          <div>
            <span class="swb-eyebrow">Spatial Result (${escapeHtml(state.layout)})</span>
            <h3 class="swb-component-title">${escapeHtml(primaryLayer?.name || 'Study Sites')}</h3>
          </div>
          <span class="swb-badge swb-badge-success">${primaryFeatures.length} feature(s)</span>
        </header>
        <div class="swb-component-body">
          <div class="swb-layer-chip-bar">
            ${state.layers
              .map(
                (l) =>
                  `<span class="swb-layer-chip ${l.id === primaryLayer?.id ? 'is-primary' : ''}"><strong>${l.id === 'study-sites' ? 'Source' : 'Output'}:</strong> ${escapeHtml(l.name)}</span>`
              )
              .join('')}
          </div>
          <div id="demoLeafletHost" class="swb-map-preview-host" style="min-height:${state.layout === 'workspace' ? '320px' : '220px'}"></div>
          <div class="swb-attribute-cards">
            ${primaryFeatures
              .map(
                (feat, idx) => `
                <article class="swb-attribute-card">
                  <strong>${escapeHtml(feat?.properties?.name || `Feature ${idx + 1}`)}</strong>
                  <span class="swb-meta-note"> · ${escapeHtml(feat?.geometry?.type || 'Geometry')}</span>
                </article>
              `
              )
              .join('')}
          </div>
        </div>
      </section>
    `;

    const r = state.lastReceipt;
    const receiptHtml = `
      <section class="swb-component swb-execution-receipt" data-component-type="ExecutionReceipt">
        <header class="swb-component-header">
          <div>
            <span class="swb-eyebrow">Execution Receipt</span>
            <h3 class="swb-component-title">${escapeHtml(r?.tool || 'BufferTool')}</h3>
          </div>
          <span class="swb-badge ${r ? (r.ok ? 'swb-badge-success' : 'swb-badge-danger') : ''}">
            ${r ? (r.ok ? 'Completed' : 'Failed') : 'Empty'}
          </span>
        </header>
        <div class="swb-component-body">
          ${
            !r
              ? '<p class="swb-empty-note">No execution has run yet. Click Run Buffer to execute against POST /api/run.</p>'
              : `
              <p>${escapeHtml(r.status?.message || '')}</p>
              <dl class="swb-receipt-grid">
                <div><dt>Duration</dt><dd>${r.execution?.durationMs ?? 0} ms</dd></div>
                <div><dt>Feature counts</dt><dd>${r.execution?.featureCounts?.input ?? 0} → ${r.execution?.featureCounts?.output ?? 0}</dd></div>
                <div><dt>Target scope</dt><dd>${escapeHtml(r.execution?.target?.mode || 'layer')} (${r.execution?.target?.selectedFeatureCount ?? 0} selected)</dd></div>
              </dl>
            `
          }
        </div>
      </section>
    `;

    if (state.layout === 'workspace') {
      host.innerHTML = `
        <div class="swb-composition swb-layout-workspace">
          <div class="swb-workspace-pane swb-workspace-controls">
            ${layerInputHtml}
            ${selectionHtml}
            ${paramsHtml}
            ${receiptHtml}
          </div>
          <div class="swb-workspace-pane swb-workspace-inspector">
            ${resultHtml}
          </div>
        </div>
      `;
    } else {
      host.innerHTML = `
        <div class="swb-composition swb-layout-compact">
          ${layerInputHtml}
          ${selectionHtml}
          ${paramsHtml}
          ${resultHtml}
          ${receiptHtml}
        </div>
      `;
    }

    wireEvents();
    mountMap();
  }

  function mountMap() {
    const mapEl = document.getElementById('demoLeafletHost');
    if (!mapEl || typeof window.L === 'undefined') return;
    try {
      const map = window.L.map(mapEl, { attributionControl: false }).setView([34.03, -118.25], 11);
      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);
      const boundsList = [];
      state.layers.forEach((layer) => {
        if (!layer.geojson) return;
        const isSource = layer.id === 'study-sites';
        const g = window.L.geoJSON(layer.geojson, {
          style: () => ({
            color: isSource ? '#94a3b8' : '#38bdf8',
            weight: isSource ? 1.5 : 2.5,
            fillOpacity: isSource ? 0.15 : 0.3,
          }),
        }).addTo(map);
        if (g.getBounds && g.getBounds().isValid()) boundsList.push(g.getBounds());
      });
      if (boundsList.length) {
        const b = boundsList.slice(1).reduce((acc, item) => acc.extend(item), boundsList[0]);
        map.fitBounds(b, { padding: [20, 20] });
      }
    } catch (_) {}
  }

  function wireEvents() {
    Array.from(host.querySelectorAll('input[name="demo-scope"]')).forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        state.selection.targetScope = e.target.value;
        state.drafts.BufferTool.targetScope = e.target.value;
        bumpRevision();
        render();
      });
    });

    const cbs = Array.from(host.querySelectorAll('.demo-feat-cb'));
    cbs.forEach((cb) => {
      cb.addEventListener('change', () => {
        state.selection.selectedFeaturesByLayerId['study-sites'] = cbs
          .filter((item) => item.checked)
          .map((item) => item.dataset.featureId);
        bumpRevision();
        render();
      });
    });

    const distInput = document.getElementById('demo-distance');
    if (distInput) {
      distInput.addEventListener('change', (e) => {
        state.drafts.BufferTool.Distance = parseFloat(e.target.value);
        bumpRevision();
        render();
      });
    }

    const unitsSelect = document.getElementById('demo-units');
    if (unitsSelect) {
      unitsSelect.addEventListener('change', (e) => {
        state.drafts.BufferTool.Units = e.target.value;
        bumpRevision();
        render();
      });
    }

    const form = document.getElementById('demoParamsForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await executeBuffer();
      });
    }
  }

  async function executeBuffer() {
    if (!state.streamComplete) return;
    const baseLayers = state.layers.filter((l) => l.id === 'study-sites');
    const resp = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'BufferTool',
        params: state.drafts.BufferTool,
        state: {
          layers: baseLayers,
          selection: state.selection,
        },
      }),
    });
    const data = await resp.json();
    if (data.state?.layers) {
      state.layers = data.state.layers;
      state.added = data.state.added || [];
    }
    state.lastReceipt = data;
    bumpRevision();
    render();
  }

  async function executeExport() {
    if (!state.streamComplete) return;
    const targetLayerId = state.added[state.added.length - 1]?.id || state.layers[state.layers.length - 1]?.id || 'study-sites';
    const resp = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'ExportTool',
        params: {
          Layer: targetLayerId,
          Format: 'GeoJSON',
          targetScope: 'layer',
        },
        state: {
          layers: state.layers,
          selection: state.selection,
        },
      }),
    });
    const data = await resp.json();
    state.lastReceipt = data;
    bumpRevision();
    render();
    if (data.output?.download) {
      triggerDownload(data.output.download);
    }
  }

  if (compactBtn && workspaceBtn) {
    compactBtn.addEventListener('click', () => {
      state.layout = 'compact';
      compactBtn.classList.add('swb-btn-active');
      workspaceBtn.classList.remove('swb-btn-active');
      render();
    });
    workspaceBtn.addEventListener('click', () => {
      state.layout = 'workspace';
      workspaceBtn.classList.add('swb-btn-active');
      compactBtn.classList.remove('swb-btn-active');
      render();
    });
  }

  if (simulateStreamBtn) {
    simulateStreamBtn.addEventListener('click', () => {
      state.streamComplete = !state.streamComplete;
      simulateStreamBtn.textContent = state.streamComplete ? 'Simulate Partial Stream' : 'Complete Stream';
      bumpRevision();
      render();
    });
  }

  if (exportOutputBtn) {
    exportOutputBtn.addEventListener('click', () => executeExport());
  }

  fetch('/api/agent-ui/catalog')
    .then((r) => r.json())
    .then((catalog) => {
      if (catalog.fixture) {
        state.layers = [catalog.fixture];
      }
      if (catalog.sampleExpressions) {
        state.expressions = catalog.sampleExpressions;
      }
      render();
    })
    .catch(() => render());
})();
