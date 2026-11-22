(function () {
  const heroRuntime = document.getElementById('heroRuntime');
  if (!heroRuntime) return;

  const mapCanvas = document.getElementById('stageMapCanvas');
  const stepButtons = Array.from(document.querySelectorAll('.pipeline-step[data-step]'));
  const inspectorTabs = Array.from(document.querySelectorAll('.inspector-tab[data-inspector-tab]'));
  const inspectorCode = document.getElementById('stageInspectorCode');
  const copyBtn = document.getElementById('copyInspectorBtn');
  const controlsForm = document.getElementById('stageControlsForm');
  const pointsInput = document.getElementById('demoPointsCount');
  const bufferInput = document.getElementById('demoBufferMeters');
  const runBtn = document.getElementById('runLiveStageBtn');
  const hudStatusBadge = document.getElementById('hudStatusBadge');
  const hudSummaryText = document.getElementById('hudSummaryText');
  const hudDownloadLink = document.getElementById('hudDownloadLink');
  const metricTotalMs = document.getElementById('metricTotalMs');
  const metricFeatureFlow = document.getElementById('metricFeatureFlow');
  const stepTimeDiscover = document.getElementById('stepTimeDiscover');
  const stepTimePoints = document.getElementById('stepTimePoints');
  const stepTimeBuffer = document.getElementById('stepTimeBuffer');
  const stepTimeExport = document.getElementById('stepTimeExport');

  const STUDY_BOUNDARY_LAYER = {
    id: 'study-boundary',
    name: 'Downtown LA Study Zone',
    geometryType: 'Polygon',
    geojson: {
      type: 'Feature',
      id: 'study-boundary-1',
      properties: {
        __id: 'study-boundary-1',
        name: 'Downtown LA Study Zone',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.268, 34.036],
            [-118.231, 34.036],
            [-118.227, 34.058],
            [-118.258, 34.063],
            [-118.268, 34.036],
          ],
        ],
      },
    },
  };

  let activeStep = 'buffer';
  let activeInspectorTab = 'receipt';
  let map = null;
  let mapLayerGroup = null;
  let currentArtifactUrl = null;

  const pipelineRecord = {
    discover: { request: { method: 'GET', path: '/api/run' }, response: null, geojson: STUDY_BOUNDARY_LAYER.geojson },
    points: { request: null, response: null, geojson: null },
    buffer: { request: null, response: null, geojson: null },
    export: { request: null, response: null, geojson: null },
  };

  function initMap() {
    if (!mapCanvas || typeof window.L === 'undefined' || map) return;
    try {
      map = window.L.map(mapCanvas, {
        attributionControl: false,
        zoomControl: true,
      }).setView([34.049, -118.248], 13);

      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
      }).addTo(map);

      mapLayerGroup = window.L.featureGroup().addTo(map);
    } catch (_) {}
  }

  function renderMapLayers() {
    initMap();
    if (!map || !mapLayerGroup || typeof window.L === 'undefined') return;

    mapLayerGroup.clearLayers();

    // 1. Study boundary polygon
    const boundaryLayer = window.L.geoJSON(STUDY_BOUNDARY_LAYER.geojson, {
      style: () => ({
        color: '#91a2b4',
        weight: 1.5,
        dashArray: '5 5',
        fillColor: '#1e293b',
        fillOpacity: 0.14,
      }),
    });
    mapLayerGroup.addLayer(boundaryLayer);

    // 2. Buffered polygons (when available and active step isn't points-only)
    if (pipelineRecord.buffer.geojson && activeStep !== 'discover' && activeStep !== 'points') {
      const bufferLayer = window.L.geoJSON(pipelineRecord.buffer.geojson, {
        style: () => ({
          color: '#76d6ff',
          weight: 2,
          fillColor: '#76d6ff',
          fillOpacity: 0.24,
        }),
        onEachFeature: (feature, layer) => {
          const id = feature?.properties?.__id || 'buffer';
          layer.bindTooltip(`Buffer · ${id}`, { sticky: true });
        },
      });
      mapLayerGroup.addLayer(bufferLayer);
    }

    // 3. Generated random points
    if (pipelineRecord.points.geojson && activeStep !== 'discover') {
      const pointsLayer = window.L.geoJSON(pipelineRecord.points.geojson, {
        pointToLayer: (feature, latlng) =>
          window.L.circleMarker(latlng, {
            radius: 5,
            color: '#041018',
            weight: 1.5,
            fillColor: '#aee6ff',
            fillOpacity: 1,
          }),
        onEachFeature: (feature, layer) => {
          const id = feature?.properties?.__id || 'point';
          const coords = feature?.geometry?.coordinates || [];
          layer.bindTooltip(
            `${id} [${Number(coords[0] || 0).toFixed(4)}, ${Number(coords[1] || 0).toFixed(4)}]`,
            { sticky: true }
          );
        },
      });
      mapLayerGroup.addLayer(pointsLayer);
    }

    try {
      const bounds = mapLayerGroup.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [26, 26] });
      }
    } catch (_) {}
  }

  function updateInspector() {
    if (!inspectorCode) return;
    const record = pipelineRecord[activeStep] || pipelineRecord.buffer;

    let payloadToRender = null;
    if (activeInspectorTab === 'request') {
      payloadToRender = record.request || { note: 'Run pipeline to inspect request payload.' };
    } else if (activeInspectorTab === 'geojson') {
      payloadToRender = record.geojson || { note: 'Run pipeline to inspect GeoJSON output.' };
    } else {
      if (activeStep === 'discover' && record.response) {
        payloadToRender = {
          ok: record.response.ok,
          method: record.response.method,
          supportedTools: (record.response.supportedTools || []).map((t) => ({
            key: t.key,
            stateMode: t.stateMode,
            parameters: (t.parameters || []).map((p) => p.name),
          })),
          spatial: record.response.spatial,
        };
      } else if (record.response) {
        payloadToRender = {
          ok: record.response.ok,
          tool: record.response.tool,
          status: record.response.status,
          execution: record.response.execution,
          spatial: record.response.spatial,
        };
      } else {
        payloadToRender = { status: 'Executing live pipeline...' };
      }
    }

    inspectorCode.textContent = JSON.stringify(payloadToRender, null, 2);
  }

  function setActiveStep(step) {
    activeStep = step;
    heroRuntime.setAttribute('data-phase', step);
    stepButtons.forEach((btn) => {
      const isMatch = btn.dataset.step === step;
      btn.classList.toggle('is-active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    updateInspector();
    renderMapLayers();
  }

  function setActiveInspectorTab(tab) {
    activeInspectorTab = tab;
    inspectorTabs.forEach((btn) => {
      const isMatch = btn.dataset.inspectorTab === tab;
      btn.classList.toggle('is-active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    updateInspector();
  }

  async function runLivePipeline() {
    const pointsCount = Math.max(2, Math.min(20, parseInt(pointsInput?.value || '6', 10) || 6));
    const bufferMeters = Math.max(50, Math.min(500, parseFloat(bufferInput?.value || '350') || 350));
    if (pointsInput) pointsInput.value = String(pointsCount);
    if (bufferInput) bufferInput.value = String(bufferMeters);

    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
    }
    if (hudStatusBadge) {
      hudStatusBadge.textContent = 'EXECUTING · POST /api/run';
    }

    try {
      // Step 1: Discover live catalog
      const discoverRes = await fetch('/api/run').then((r) => r.json());
      pipelineRecord.discover.response = discoverRes;
      if (stepTimeDiscover) {
        stepTimeDiscover.textContent = `${(discoverRes.supportedTools || []).length} tools`;
      }

      // Step 2: RandomPointsTool inside Study Boundary
      const pointsReq = {
        tool: 'RandomPointsTool',
        params: {
          'Points Count': pointsCount,
          'Inside Polygon': true,
          Polygon: STUDY_BOUNDARY_LAYER.id,
        },
        state: {
          layers: [STUDY_BOUNDARY_LAYER],
        },
      };
      pipelineRecord.points.request = pointsReq;
      const pointsRes = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pointsReq),
      }).then((r) => r.json());
      pipelineRecord.points.response = pointsRes;
      const pointsLayerId = pointsRes?.state?.added?.[0]?.id;
      const pointsLayer = (pointsRes?.state?.layers || []).find((l) => l.id === pointsLayerId);
      pipelineRecord.points.geojson = pointsLayer?.geojson || null;
      if (stepTimePoints) {
        stepTimePoints.textContent = `${pointsRes?.execution?.durationMs ?? 0} ms`;
      }

      // Step 3: BufferTool in meters
      const bufferReq = {
        tool: 'BufferTool',
        params: {
          'Input Layer': pointsLayerId,
          Distance: bufferMeters,
          Units: 'meters',
        },
        state: pointsRes.state,
      };
      pipelineRecord.buffer.request = bufferReq;
      const bufferRes = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bufferReq),
      }).then((r) => r.json());
      pipelineRecord.buffer.response = bufferRes;
      const bufferLayerId = bufferRes?.state?.added?.[0]?.id;
      const bufferLayer = (bufferRes?.state?.layers || []).find((l) => l.id === bufferLayerId);
      pipelineRecord.buffer.geojson = bufferLayer?.geojson || null;
      if (stepTimeBuffer) {
        stepTimeBuffer.textContent = `${bufferRes?.execution?.durationMs ?? 0} ms`;
      }

      // Step 4: ExportTool
      const exportReq = {
        tool: 'ExportTool',
        params: {
          Layer: bufferLayerId,
          Format: 'GeoJSON',
        },
        state: bufferRes.state,
      };
      pipelineRecord.export.request = exportReq;
      const exportRes = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportReq),
      }).then((r) => r.json());
      pipelineRecord.export.response = exportRes;
      const exportedText = exportRes?.output?.download?.data || '{}';
      try {
        pipelineRecord.export.geojson = JSON.parse(exportedText);
      } catch (_) {
        pipelineRecord.export.geojson = null;
      }
      if (stepTimeExport) {
        stepTimeExport.textContent = `${exportRes?.execution?.durationMs ?? 0} ms`;
      }

      const totalMs =
        (pointsRes?.execution?.durationMs || 0) +
        (bufferRes?.execution?.durationMs || 0) +
        (exportRes?.execution?.durationMs || 0);

      if (metricTotalMs) metricTotalMs.textContent = `${totalMs} ms`;
      if (metricFeatureFlow) metricFeatureFlow.textContent = `${pointsCount} pts → ${pointsCount} buffers`;
      if (hudStatusBadge) hudStatusBadge.textContent = `LIVE · ${totalMs} ms`;
      if (hudSummaryText) {
        hudSummaryText.textContent = `EPSG:4326 · ${pointsCount} points → ${bufferMeters} m buffer`;
      }

      if (hudDownloadLink && exportedText) {
        if (currentArtifactUrl) URL.revokeObjectURL(currentArtifactUrl);
        const blob = new Blob([`${exportedText}\n`], { type: 'application/geo+json' });
        currentArtifactUrl = URL.createObjectURL(blob);
        hudDownloadLink.href = currentArtifactUrl;
      }

      updateInspector();
      renderMapLayers();
    } catch (err) {
      if (hudStatusBadge) hudStatusBadge.textContent = 'OFFLINE PREVIEW';
      if (inspectorCode) {
        inspectorCode.textContent = JSON.stringify({ error: err.message || 'Failed to execute live pipeline.' }, null, 2);
      }
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Live';
      }
    }
  }

  stepButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveStep(btn.dataset.step));
  });

  inspectorTabs.forEach((btn) => {
    btn.addEventListener('click', () => setActiveInspectorTab(btn.dataset.inspectorTab));
  });

  if (controlsForm) {
    controlsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      runLivePipeline();
    });
  }

  if (copyBtn && inspectorCode) {
    copyBtn.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inspectorCode.textContent || '');
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1200);
      }
    });
  }

  initMap();
  renderMapLayers();
  runLivePipeline();
})();
