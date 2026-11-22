const { createSpatialSession, ensureFeatureId } = require('../spatial');
const { getInputLayerIds } = require('../runtime/executionSpec');
const { getHeadlessToolCatalog, runHeadlessTool } = require('../headless-runtime');
const {
  CONTRACT_VERSION,
  createExecutionReceiptModel,
  createToolParametersModel,
  resolveComposition,
  validateComponentEvent,
} = require('./contracts');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeLayerRecord(rawLayer, index = 0) {
  const id = rawLayer?.id || `layer-${index + 1}`;
  const name = rawLayer?.displayName || rawLayer?.name || id;
  const geojson = deepClone(rawLayer?.geojson ?? rawLayer?.data ?? rawLayer);

  if (geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    geojson.features.forEach((feature, fIdx) => ensureFeatureId(feature, `${id}-${fIdx + 1}`));
  } else if (geojson?.type === 'Feature') {
    ensureFeatureId(geojson, `${id}-1`);
  }

  const geometryType = rawLayer?.geometryType
    || geojson?.geometry?.type
    || (geojson?.type === 'FeatureCollection' ? (geojson.features?.[0]?.geometry?.type || 'FeatureCollection') : 'Layer');

  return {
    id,
    name,
    displayName: name,
    geometryType,
    geojson,
  };
}

function countGeojsonFeatures(geojson) {
  if (!geojson || typeof geojson !== 'object') return 0;
  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features) ? geojson.features.length : 0;
  }
  if (geojson.type === 'Feature') return 1;
  return 0;
}

function buildLocalExecutionMetadata({ toolSpec, params, requestState, result, startedAt, finishedAt }) {
  if (result?.execution) return result.execution;
  const inputs = Array.isArray(toolSpec?.execution?.inputs) ? toolSpec.execution.inputs : [];
  const outputs = Array.isArray(toolSpec?.execution?.outputs) ? toolSpec.execution.outputs : [];
  const inputLayerIds = getInputLayerIds(toolSpec, params);
  const outputLayerIds = outputs.some((output) => output.kind === 'layer' && output.operation === 'add')
    ? (Array.isArray(result?.state?.added) ? result.state.added.map((layer) => layer.id).filter(Boolean) : [])
    : [];
  const producesArtifact = outputs.some((output) => output.kind === 'artifact');

  const findLayerCount = (stateObj, layerId) => {
    const layer = (stateObj?.layers || []).find((candidate) => candidate.id === layerId);
    return countGeojsonFeatures(layer?.geojson);
  };

  let inputCount = inputLayerIds.reduce((sum, id) => sum + findLayerCount(requestState, id), 0);
  if (result?.target?.mode === 'selection' && Number.isFinite(result?.target?.selectedFeatureCount)) {
    inputCount = result.target.selectedFeatureCount;
  }

  let outputCount = outputLayerIds.reduce((sum, id) => sum + findLayerCount(result?.state, id), 0);
  if (producesArtifact && result?.output?.download?.data) {
    try {
      outputCount = countGeojsonFeatures(JSON.parse(result.output.download.data));
    } catch (_) {
      outputCount = 0;
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    inputLayerIds,
    outputLayerIds,
    featureCounts: {
      input: inputCount,
      output: outputCount,
    },
    ...(result?.target ? { target: deepClone(result.target) } : {}),
    datasetHandles: {
      read: [],
      produced: [],
      expired: [],
    },
  };
}

function createComponentSession(initialInput = {}, options = {}) {
  const toolCatalog = options.toolCatalog || getHeadlessToolCatalog();
  const specMap = new Map(toolCatalog.map((spec) => [spec.key, spec]));

  let stateRevision = Number.isInteger(initialInput.stateRevision) && initialInput.stateRevision >= 1
    ? initialInput.stateRevision
    : 1;
  let streamComplete = initialInput.streamComplete !== false;

  let layers = (Array.isArray(initialInput.layers) ? initialInput.layers : []).map(normalizeLayerRecord);
  let added = Array.isArray(initialInput.added) ? deepClone(initialInput.added) : [];
  let removed = Array.isArray(initialInput.removed) ? [...initialInput.removed] : [];
  let bbox = Array.isArray(initialInput.bbox) ? [...initialInput.bbox] : null;

  const rawSelection = initialInput.selection || {};
  let selection = {
    activeLayerId: rawSelection.activeLayerId || layers[0]?.id || null,
    selectedLayerIds: Array.isArray(rawSelection.selectedLayerIds)
      ? [...new Set(rawSelection.selectedLayerIds)]
      : (layers[0]?.id ? [layers[0].id] : []),
    selectedFeaturesByLayerId: deepClone(rawSelection.selectedFeaturesByLayerId || {}),
    targetScope: rawSelection.targetScope === 'selection' ? 'selection' : 'layer',
  };

  const drafts = deepClone(initialInput.drafts || {});
  const receipts = [];
  const lastDerivedLayerByToolAndSource = new Map();
  let lastRunResponse = null;

  function bumpRevision() {
    stateRevision += 1;
    return stateRevision;
  }

  function getState() {
    return {
      contractVersion: CONTRACT_VERSION,
      stateRevision,
      streamComplete,
      layers: deepClone(layers),
      added: deepClone(added),
      removed: [...removed],
      bbox: bbox ? [...bbox] : null,
      selection: deepClone(selection),
      drafts: deepClone(drafts),
      receipts: deepClone(receipts),
      lastRunResponse: deepClone(lastRunResponse),
    };
  }

  function getRuntimeStatePayload() {
    return {
      layers: layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        geometryType: layer.geometryType,
        geojson: deepClone(layer.geojson),
      })),
      ...(bbox ? { bbox: [...bbox] } : {}),
      selection: deepClone(selection),
    };
  }

  function setStreamComplete(nextComplete) {
    const normalized = Boolean(nextComplete);
    if (streamComplete !== normalized) {
      streamComplete = normalized;
      bumpRevision();
    }
    return {
      ok: true,
      streamComplete,
      stateRevision,
    };
  }

  function selectLayer({ layerId, targetScope, toolKey, parameterName } = {}) {
    if (layerId && layers.some((layer) => layer.id === layerId)) {
      selection.activeLayerId = layerId;
      if (!selection.selectedLayerIds.includes(layerId)) {
        selection.selectedLayerIds = [layerId, ...selection.selectedLayerIds];
      }
    }
    if (targetScope === 'layer' || targetScope === 'selection') {
      selection.targetScope = targetScope;
    }
    if (toolKey) {
      drafts[toolKey] = {
        ...(drafts[toolKey] || {}),
        ...(parameterName && layerId ? { [parameterName]: layerId } : {}),
        ...(targetScope ? { targetScope: selection.targetScope } : {}),
      };
    }
    bumpRevision();
    return {
      ok: true,
      stateRevision,
      selection: deepClone(selection),
    };
  }

  function setFeatureSelection({ layerId, selectedFeatureIds = [], targetScope } = {}) {
    const targetLayerId = layerId || selection.activeLayerId || layers[0]?.id;
    if (!targetLayerId || !layers.some((layer) => layer.id === targetLayerId)) {
      return {
        ok: false,
        reason: 'layer-not-found',
        stateRevision,
      };
    }

    const cleanIds = Array.isArray(selectedFeatureIds)
      ? [...new Set(selectedFeatureIds.filter(Boolean))]
      : [];
    if (cleanIds.length) {
      selection.selectedFeaturesByLayerId[targetLayerId] = cleanIds;
    } else {
      delete selection.selectedFeaturesByLayerId[targetLayerId];
    }

    selection.activeLayerId = targetLayerId;
    if (!selection.selectedLayerIds.includes(targetLayerId)) {
      selection.selectedLayerIds.push(targetLayerId);
    }
    if (targetScope === 'layer' || targetScope === 'selection') {
      selection.targetScope = targetScope;
    }

    bumpRevision();
    return {
      ok: true,
      stateRevision,
      selection: deepClone(selection),
    };
  }

  function updateDraftParams({ toolKey, params = {} } = {}) {
    if (!toolKey || typeof toolKey !== 'string') {
      return {
        ok: false,
        reason: 'missing-tool-key',
        stateRevision,
      };
    }

    drafts[toolKey] = {
      ...(drafts[toolKey] || {}),
      ...deepClone(params),
    };

    if (params.targetScope === 'layer' || params.targetScope === 'selection') {
      selection.targetScope = params.targetScope;
    }

    bumpRevision();
    return {
      ok: true,
      stateRevision,
      draft: deepClone(drafts[toolKey]),
    };
  }

  function applyAgentProposal({
    baseRevision,
    toolKey,
    draftParams,
    selection: proposedSelection,
    streamComplete: proposedStreamComplete,
  } = {}) {
    if (Number.isInteger(baseRevision) && baseRevision < stateRevision) {
      return {
        applied: false,
        reason: 'stale-revision',
        stateRevision,
      };
    }

    if (proposedStreamComplete !== undefined) {
      streamComplete = Boolean(proposedStreamComplete);
    }

    if (proposedSelection && typeof proposedSelection === 'object') {
      if (proposedSelection.activeLayerId && layers.some((l) => l.id === proposedSelection.activeLayerId)) {
        selection.activeLayerId = proposedSelection.activeLayerId;
      }
      if (proposedSelection.targetScope === 'layer' || proposedSelection.targetScope === 'selection') {
        selection.targetScope = proposedSelection.targetScope;
      }
      if (proposedSelection.selectedFeaturesByLayerId && typeof proposedSelection.selectedFeaturesByLayerId === 'object') {
        selection.selectedFeaturesByLayerId = deepClone(proposedSelection.selectedFeaturesByLayerId);
      }
    }

    if (toolKey && draftParams && typeof draftParams === 'object') {
      drafts[toolKey] = {
        ...(drafts[toolKey] || {}),
        ...deepClone(draftParams),
      };
    }

    bumpRevision();
    return {
      applied: true,
      stateRevision,
      streamComplete,
    };
  }

  function dispatchEvent(event = {}) {
    const validation = validateComponentEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'invalid-event',
        errors: validation.errors,
        stateRevision,
      };
    }

    if (event.stateRevision < stateRevision) {
      return {
        ok: false,
        reason: 'stale-revision',
        errors: [`Event stateRevision (${event.stateRevision}) is older than current session stateRevision (${stateRevision}).`],
        stateRevision,
      };
    }

    const payload = event.payload || {};
    if (event.eventType === 'swb:layer-selected') {
      return selectLayer({
        layerId: payload.layerId,
        targetScope: payload.targetScope || payload.scope,
        toolKey: payload.toolKey || payload.tool,
        parameterName: payload.parameterName,
      });
    }

    if (event.eventType === 'swb:selection-changed') {
      return setFeatureSelection({
        layerId: payload.layerId,
        selectedFeatureIds: payload.selectedFeatureIds,
        targetScope: payload.targetScope || payload.scope,
      });
    }

    if (event.eventType === 'swb:params-draft-changed') {
      return updateDraftParams({
        toolKey: payload.toolKey || payload.tool,
        params: payload.params,
      });
    }

    return {
      ok: true,
      eventType: event.eventType,
      stateRevision,
    };
  }

  async function executeTool({
    toolKey,
    params: overrideParams = null,
    expectedRevision = null,
    replacePreviousOutput = true,
    runner = null,
  } = {}) {
    if (!streamComplete) {
      return {
        ok: false,
        reason: 'stream-incomplete',
        errors: ['Cannot execute tool while agent UI stream is incomplete.'],
        stateRevision,
      };
    }

    if (Number.isInteger(expectedRevision) && expectedRevision < stateRevision) {
      return {
        ok: false,
        reason: 'stale-revision',
        errors: [`Execution request revision (${expectedRevision}) is stale (current: ${stateRevision}).`],
        stateRevision,
      };
    }

    if (overrideParams && typeof overrideParams === 'object') {
      drafts[toolKey] = {
        ...(drafts[toolKey] || {}),
        ...deepClone(overrideParams),
      };
    }

    const currentSnapshot = getState();
    const paramModel = createToolParametersModel({ toolKey }, currentSnapshot, { toolCatalog });
    const executedParams = deepClone(paramModel.result.params);
    const toolSpec = specMap.get(toolKey) || null;

    const primaryLayerInput = (toolSpec?.execution?.inputs || []).find(
      (input) => input.kind === 'layer' && input.parameter
    );
    const sourceLayerId = primaryLayerInput ? executedParams[primaryLayerInput.parameter] : null;
    const slotKey = `${toolKey}::${sourceLayerId || 'default'}`;

    let workingLayers = deepClone(layers);
    if (replacePreviousOutput && lastDerivedLayerByToolAndSource.has(slotKey)) {
      const previousOutputId = lastDerivedLayerByToolAndSource.get(slotKey);
      if (previousOutputId && previousOutputId !== sourceLayerId) {
        workingLayers = workingLayers.filter((layer) => layer.id !== previousOutputId);
      }
    }

    const requestState = {
      layers: workingLayers,
      ...(bbox ? { bbox: [...bbox] } : {}),
      selection: deepClone(selection),
    };

    const startedAt = new Date();
    let rawResponse;
    if (typeof runner === 'function') {
      rawResponse = await runner({
        tool: toolKey,
        params: executedParams,
        state: requestState,
      });
    } else {
      const spatialSession = createSpatialSession();
      const headlessResult = await runHeadlessTool({
        tool: toolKey,
        params: executedParams,
        state: requestState,
        spatial: spatialSession,
      });
      const finishedAt = new Date();
      rawResponse = {
        ...headlessResult,
        spatial: spatialSession.toJSON(),
        execution: buildLocalExecutionMetadata({
          toolSpec,
          params: executedParams,
          requestState,
          result: headlessResult,
          startedAt,
          finishedAt,
        }),
      };
    }

    if (rawResponse?.state?.layers) {
      layers = rawResponse.state.layers.map(normalizeLayerRecord);
      added = Array.isArray(rawResponse.state.added) ? deepClone(rawResponse.state.added) : [];
      removed = Array.isArray(rawResponse.state.removed) ? [...rawResponse.state.removed] : [];
      if (rawResponse.state.selection) {
        selection = {
          ...selection,
          ...deepClone(rawResponse.state.selection),
          targetScope: rawResponse.state.selection.targetScope || selection.targetScope,
        };
      }
    }

    if (rawResponse?.ok && added.length > 0 && sourceLayerId) {
      lastDerivedLayerByToolAndSource.set(slotKey, added[0].id);
    }

    lastRunResponse = deepClone(rawResponse);
    bumpRevision();

    const receiptModel = createExecutionReceiptModel(
      {
        componentId: `receipt-${receipts.length + 1}`,
        toolKey,
      },
      rawResponse,
      getState()
    );
    receipts.push(receiptModel);

    return {
      ok: Boolean(rawResponse?.ok),
      stateRevision,
      executedParams,
      response: deepClone(rawResponse),
      receipt: receiptModel,
      state: getState(),
    };
  }

  function resolveLayout(compositionDescriptor = {}) {
    return resolveComposition(compositionDescriptor, getState(), {
      toolCatalog,
      lastRunResponse,
    });
  }

  return {
    getState,
    getRuntimeStatePayload,
    setStreamComplete,
    selectLayer,
    setFeatureSelection,
    updateDraftParams,
    applyAgentProposal,
    dispatchEvent,
    executeTool,
    resolveLayout,
  };
}

module.exports = {
  createComponentSession,
};
