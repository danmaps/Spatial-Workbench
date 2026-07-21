(function () {
  const runButton = document.getElementById('runDemoButton');
  const statusBadge = document.getElementById('runStatusBadge');
  const runMessage = document.getElementById('runMessage');
  const receiptList = document.getElementById('receiptList');
  const exportPreview = document.getElementById('exportPreview');
  const downloadArtifactLink = document.getElementById('downloadArtifactLink');
  const artifactSummary = document.getElementById('artifactSummary');
  const catalogList = document.getElementById('catalogList');
  const catalogSummary = document.getElementById('toolCatalogSummary');
  const serverOriginValue = document.getElementById('serverOriginValue');

  const API_PATH = '/api/run';
  const REQUIRED_TOOLS = ['RandomPointsTool', 'BufferTool', 'ExportTool'];

  function setStatus(label, tone) {
    statusBadge.textContent = label;
    statusBadge.className = `demo-badge ${tone ? `demo-badge-${tone}` : 'demo-badge-muted'}`;
  }

  function setMessage(message, tone) {
    runMessage.textContent = message;
    runMessage.className = `demo-message ${tone ? `demo-message-${tone}` : 'demo-message-neutral'}`;
  }

  function formatLayerIds(ids) {
    return Array.isArray(ids) && ids.length ? ids.join(', ') : 'none';
  }

  function createReceiptCard(stepLabel, toolKey, response) {
    const execution = response.execution || {};
    const status = response.status || {};
    const article = document.createElement('article');
    article.className = 'receipt-card';
    article.innerHTML = `
      <div class="receipt-card-header">
        <h3>${stepLabel}: ${toolKey}</h3>
        <span class="demo-badge ${response.ok ? 'demo-badge-success' : 'demo-badge-danger'}">${response.ok ? 'ok' : 'error'}</span>
      </div>
      <p class="receipt-summary">${status.message || 'No status message returned.'}</p>
      <div class="receipt-details">
        <div class="receipt-detail">
          <span class="receipt-detail-label">Duration</span>
          <span class="receipt-detail-value">${execution.durationMs ?? '?'} ms</span>
        </div>
        <div class="receipt-detail">
          <span class="receipt-detail-label">Input layers</span>
          <span class="receipt-detail-value">${formatLayerIds(execution.inputLayerIds)}</span>
        </div>
        <div class="receipt-detail">
          <span class="receipt-detail-label">Output layers</span>
          <span class="receipt-detail-value">${formatLayerIds(execution.outputLayerIds)}</span>
        </div>
        <div class="receipt-detail">
          <span class="receipt-detail-label">Feature counts</span>
          <span class="receipt-detail-value">${execution.featureCounts?.input ?? 0} -> ${execution.featureCounts?.output ?? 0}</span>
        </div>
      </div>
    `;
    return article;
  }

  function renderCatalog(tools) {
    const list = Array.isArray(tools) ? tools : [];
    catalogSummary.textContent = `${list.length} tools available`;
    catalogList.innerHTML = '';

    list.forEach((tool) => {
      const article = document.createElement('article');
      article.className = 'catalog-card';
      article.innerHTML = `
        <div class="catalog-card-header">
          <h3>${tool.key}</h3>
          <span class="demo-badge">${tool.stateMode}</span>
        </div>
        <p class="catalog-meta">${tool.description || 'No description provided.'}</p>
      `;
      catalogList.appendChild(article);
    });
  }

  async function requestJson(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  }

  function getAddedLayerId(response, toolKey) {
    const layerId = response?.state?.added?.[0]?.id;
    if (!layerId) {
      throw new Error(`${toolKey} did not return an added layer id.`);
    }
    return layerId;
  }

  function updateArtifactPreview(geojsonText) {
    exportPreview.textContent = geojsonText;
    const blob = new Blob([`${geojsonText}\n`], { type: 'application/geo+json' });
    const objectUrl = URL.createObjectURL(blob);
    downloadArtifactLink.href = objectUrl;
    downloadArtifactLink.classList.remove('disabled');
    downloadArtifactLink.setAttribute('aria-disabled', 'false');
    artifactSummary.textContent = `${blob.size} byte GeoJSON ready`;
  }

  async function loadCatalog() {
    const discovery = await requestJson(API_PATH);
    if (!discovery.ok || !discovery.data?.ok) {
      throw new Error('Failed to load live tool catalog.');
    }

    const tools = Array.isArray(discovery.data.supportedTools) ? discovery.data.supportedTools : [];
    renderCatalog(tools);
    const available = new Set(tools.map((tool) => tool.key));
    REQUIRED_TOOLS.forEach((toolKey) => {
      if (!available.has(toolKey)) {
        throw new Error(`Live catalog is missing ${toolKey}.`);
      }
    });
    return tools;
  }

  async function runDemo() {
    runButton.disabled = true;
    receiptList.innerHTML = '';
    downloadArtifactLink.classList.add('disabled');
    downloadArtifactLink.removeAttribute('href');
    downloadArtifactLink.setAttribute('aria-disabled', 'true');
    artifactSummary.textContent = 'Generating...';
    exportPreview.textContent = 'Running live requests...';
    setStatus('Running', 'success');
    setMessage('Calling the live server and chaining the returned state across each step.', 'success');

    try {
      const tools = await loadCatalog();
      catalogSummary.textContent = `${tools.length} tools available`;

      let state = {
        bbox: [-118.5, 33.5, -118.2, 33.8],
      };

      const randomPoints = await requestJson(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'RandomPointsTool',
          params: {
            'Points Count': 5,
            'Inside Polygon': false,
          },
          state,
        }),
      });

      if (!randomPoints.ok || !randomPoints.data?.ok) {
        throw new Error(randomPoints.data?.status?.message || 'RandomPointsTool failed.');
      }
      receiptList.appendChild(createReceiptCard('Step 1', 'RandomPointsTool', randomPoints.data));
      state = randomPoints.data.state;
      const randomPointsLayerId = getAddedLayerId(randomPoints.data, 'RandomPointsTool');

      const buffer = await requestJson(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'BufferTool',
          params: {
            'Input Layer': randomPointsLayerId,
            Distance: 0.5,
            Units: 'kilometers',
          },
          state,
        }),
      });

      if (!buffer.ok || !buffer.data?.ok) {
        throw new Error(buffer.data?.status?.message || 'BufferTool failed.');
      }
      receiptList.appendChild(createReceiptCard('Step 2', 'BufferTool', buffer.data));
      state = buffer.data.state;
      const bufferedLayerId = getAddedLayerId(buffer.data, 'BufferTool');

      const exportResult = await requestJson(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'ExportTool',
          params: {
            Layer: bufferedLayerId,
            Format: 'GeoJSON',
          },
          state,
        }),
      });

      if (!exportResult.ok || !exportResult.data?.ok) {
        throw new Error(exportResult.data?.status?.message || 'ExportTool failed.');
      }
      receiptList.appendChild(createReceiptCard('Step 3', 'ExportTool', exportResult.data));

      const geojsonText = exportResult.data?.output?.download?.data;
      if (typeof geojsonText !== 'string' || !geojsonText.trim()) {
        throw new Error('ExportTool did not return GeoJSON text.');
      }

      updateArtifactPreview(geojsonText);
      setStatus('Succeeded', 'success');
      setMessage('Live server run completed. The browser called the deployed runtime directly and produced a downloadable GeoJSON artifact.', 'success');
    } catch (error) {
      if (!receiptList.children.length) {
        receiptList.innerHTML = '<div class="receipt-empty">No successful receipts were captured before the run failed.</div>';
      }
      artifactSummary.textContent = 'Run failed';
      exportPreview.textContent = error.message || String(error);
      setStatus('Failed', 'danger');
      setMessage(error.message || String(error), 'error');
    } finally {
      runButton.disabled = false;
    }
  }

  serverOriginValue.textContent = window.location.origin;
  runButton.addEventListener('click', runDemo);

  loadCatalog()
    .then((tools) => {
      catalogSummary.textContent = `${tools.length} tools available`;
      setMessage('Live tool catalog loaded. Run the demo whenever you want.', null);
    })
    .catch((error) => {
      catalogSummary.textContent = 'Catalog unavailable';
      catalogList.innerHTML = '<div class="receipt-empty">Failed to load the live catalog.</div>';
      setStatus('Catalog error', 'danger');
      setMessage(error.message || String(error), 'error');
    });
}());
