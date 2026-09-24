(function () {
  const API_PATH = '/api/run';
  const REQUIRED_TOOLS = ['RandomPointsTool', 'BufferTool', 'ExportTool'];
  const HERO_PHASES = ['discover', 'points', 'buffer', 'export'];

  const heroRuntime = document.getElementById('heroRuntime');
  const heroRunButton = document.getElementById('heroRunButton');
  const proofRunButton = document.getElementById('proofRunButton');
  const proofStatus = document.getElementById('proofStatus');
  const proofMap = document.getElementById('proofMap');
  const proofReceiptPreview = document.getElementById('proofReceiptPreview');
  const proofGeojsonPreview = document.getElementById('proofGeojsonPreview');
  const proofDownloadLink = document.getElementById('proofDownloadLink');

  const stepCards = {
    RandomPointsTool: document.getElementById('proofStepPoints'),
    BufferTool: document.getElementById('proofStepBuffer'),
    ExportTool: document.getElementById('proofStepExport'),
  };

  const stepOutputs = {
    pointsOutput: document.getElementById('proofPointsOutput'),
    pointsFeatures: document.getElementById('proofPointsFeatures'),
    bufferInput: document.getElementById('proofBufferInput'),
    bufferOutput: document.getElementById('proofBufferOutput'),
    exportArtifact: document.getElementById('proofExportArtifact'),
    exportFeatures: document.getElementById('proofExportFeatures'),
    pointsSummary: document.getElementById('proofStepPointsSummary'),
    bufferSummary: document.getElementById('proofStepBufferSummary'),
    exportSummary: document.getElementById('proofStepExportSummary'),
  };

  let heroPhaseIndex = 0;

  function cycleHeroPhases() {
    if (!heroRuntime) return;
    heroPhaseIndex = (heroPhaseIndex + 1) % HERO_PHASES.length;
    heroRuntime.setAttribute('data-phase', HERO_PHASES[heroPhaseIndex]);
  }

  function requestJson(path, options) {
    return fetch(path, options).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      data: await response.json(),
    }));
  }

  function setStatus(label, tone) {
    proofStatus.textContent = label;
    proofStatus.className = `status-pill${tone ? ` is-${tone}` : ''}`;
  }

  function activateCard(toolKey, state) {
    Object.values(stepCards).forEach((card) => card.classList.remove('is-active'));
    if (stepCards[toolKey]) {
      stepCards[toolKey].classList.add('is-active');
      if (state === 'done') {
        stepCards[toolKey].classList.add('is-done');
      }
    }
  }

  function markDone(toolKey) {
    if (stepCards[toolKey]) {
      stepCards[toolKey].classList.add('is-done');
      stepCards[toolKey].classList.remove('is-active');
    }
  }

  function resetProofState() {
    Object.values(stepCards).forEach((card) => {
      card.classList.remove('is-active', 'is-done');
    });
    proofMap.classList.remove('has-points', 'has-buffers');
    stepOutputs.pointsOutput.textContent = 'pending';
    stepOutputs.pointsFeatures.textContent = '5 planned';
    stepOutputs.bufferInput.textContent = 'pending';
    stepOutputs.bufferOutput.textContent = 'pending';
    stepOutputs.exportArtifact.textContent = 'pending';
    stepOutputs.exportFeatures.textContent = 'pending';
    stepOutputs.pointsSummary.textContent = 'Creates five sample features inside a request-scoped bbox.';
    stepOutputs.bufferSummary.textContent = 'Buffers the returned layer id from step one.';
    stepOutputs.exportSummary.textContent = 'Exports the buffered layer as portable GeoJSON.';
    proofReceiptPreview.textContent = 'Run the workflow to populate a real receipt.';
    proofGeojsonPreview.textContent = 'Waiting for export...';
    proofDownloadLink.classList.add('is-disabled');
    proofDownloadLink.removeAttribute('href');
    proofDownloadLink.setAttribute('aria-disabled', 'true');
    setStatus('Ready', null);
  }

  function ensureDiscovery(tools) {
    const available = new Set((tools || []).map((tool) => tool.key));
    REQUIRED_TOOLS.forEach((toolKey) => {
      if (!available.has(toolKey)) {
        throw new Error(`Live catalog is missing ${toolKey}.`);
      }
    });
  }

  function getAddedLayerId(response, toolKey) {
    const layerId = response?.state?.added?.[0]?.id;
    if (!layerId) {
      throw new Error(`${toolKey} did not return an added layer id.`);
    }
    return layerId;
  }

  function createObjectUrl(text) {
    const blob = new Blob([`${text}\n`], { type: 'application/geo+json' });
    return {
      blob,
      url: URL.createObjectURL(blob),
    };
  }

  function appendWarnings(summary, response) {
    const warnings = Array.isArray(response?.spatial?.warnings) ? response.spatial.warnings : [];
    if (!warnings.length) return summary;
    return `${summary} ${warnings.length} spatial warning(s).`;
  }

  async function runWorkflow() {
    proofRunButton.disabled = true;
    heroRunButton.disabled = true;
    resetProofState();
    setStatus('Running', 'running');

    try {
      const discovery = await requestJson(API_PATH);
      if (!discovery.ok || !discovery.data?.ok) {
        throw new Error('Failed to load tool discovery.');
      }
      ensureDiscovery(discovery.data.supportedTools);

      let state = {
        bbox: [-118.5, 33.5, -118.2, 33.8],
      };

      activateCard('RandomPointsTool');
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

      proofMap.classList.add('has-points');
      stepOutputs.pointsOutput.textContent = randomPoints.data.execution.outputLayerIds.join(', ');
      stepOutputs.pointsFeatures.textContent = `${randomPoints.data.execution.featureCounts.output} created`;
      stepOutputs.pointsSummary.textContent = appendWarnings(randomPoints.data.status.message, randomPoints.data);
      state = randomPoints.data.state;
      const randomPointsLayerId = getAddedLayerId(randomPoints.data, 'RandomPointsTool');
      markDone('RandomPointsTool');

      activateCard('BufferTool');
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

      proofMap.classList.add('has-buffers');
      stepOutputs.bufferInput.textContent = randomPointsLayerId;
      stepOutputs.bufferOutput.textContent = buffer.data.execution.outputLayerIds.join(', ');
      stepOutputs.bufferSummary.textContent = appendWarnings(buffer.data.status.message, buffer.data);
      state = buffer.data.state;
      const bufferedLayerId = getAddedLayerId(buffer.data, 'BufferTool');
      markDone('BufferTool');

      activateCard('ExportTool');
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

      const artifactText = exportResult.data?.output?.download?.data;
      if (typeof artifactText !== 'string' || !artifactText.trim()) {
        throw new Error('ExportTool did not return GeoJSON text.');
      }

      const receiptPreview = {
        tool: exportResult.data.tool,
        status: exportResult.data.status,
        execution: exportResult.data.execution,
        spatial: exportResult.data.spatial,
      };
      const { blob, url } = createObjectUrl(artifactText);
      stepOutputs.exportArtifact.textContent = `headless-demo.geojson (${blob.size} bytes)`;
      stepOutputs.exportFeatures.textContent = `${exportResult.data.execution.featureCounts.output} features`;
      stepOutputs.exportSummary.textContent = appendWarnings(exportResult.data.status.message, exportResult.data);
      proofReceiptPreview.textContent = JSON.stringify(receiptPreview, null, 2);
      proofGeojsonPreview.textContent = artifactText.slice(0, 1400);
      proofDownloadLink.href = url;
      proofDownloadLink.classList.remove('is-disabled');
      proofDownloadLink.setAttribute('aria-disabled', 'false');
      markDone('ExportTool');
      setStatus('Succeeded', null);
    } catch (error) {
      proofReceiptPreview.textContent = JSON.stringify({
        ok: false,
        error: error.message || String(error),
      }, null, 2);
      proofGeojsonPreview.textContent = error.message || String(error);
      setStatus('Failed', 'error');
    } finally {
      proofRunButton.disabled = false;
      heroRunButton.disabled = false;
    }
  }

  if (heroRuntime) {
    window.setInterval(cycleHeroPhases, 1600);
  }

  if (heroRunButton) {
    heroRunButton.addEventListener('click', () => {
      const proofSection = document.getElementById('liveProof');
      if (proofSection) {
        proofSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      window.setTimeout(runWorkflow, 250);
    });
  }

  if (proofRunButton) {
    proofRunButton.addEventListener('click', runWorkflow);
  }

  resetProofState();
}());
