const { filterCompatibleLayers, getExecutionInputs, validateExecutionSpec } = require('../runtime/executionSpec');
const { SPATIAL_METADATA, ensureFeatureId } = require('../spatial');
const { getAttributeModel, normalizeToFeatures, stringifyValue } = require('../ui/attribute-view');
const { getHeadlessToolCatalog, HEADLESS_TOOLS, createHeadlessRuntime } = require('../headless-runtime');

const CONTRACT_VERSION = 'swb.ui.v0';

const LIFECYCLE_STATES = Object.freeze([
  'loading',
  'empty',
  'draft',
  'invalid',
  'running',
  'partial',
  'failed',
  'completed',
]);

const COMPONENT_TYPES = Object.freeze([
  'LayerInput',
  'SpatialSelection',
  'ToolParameters',
  'SpatialResult',
  'ExecutionReceipt',
]);

const EVENT_TYPES = Object.freeze([
  'swb:layer-selected',
  'swb:selection-changed',
  'swb:params-draft-changed',
  'swb:execute-requested',
  'swb:artifact-download',
]);

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeLifecycle(lifecycle, fallback = 'draft') {
  return LIFECYCLE_STATES.includes(lifecycle) ? lifecycle : fallback;
}

function getToolSpecMap(toolCatalog = null) {
  const catalog = Array.isArray(toolCatalog) ? toolCatalog : getHeadlessToolCatalog();
  return new Map(catalog.map((spec) => [spec.key, spec]));
}

function createEnvelope(props = {}, sessionState = {}, overrides = {}) {
  const streamComplete = overrides.streamComplete !== undefined
    ? Boolean(overrides.streamComplete)
    : (props.streamComplete !== undefined ? Boolean(props.streamComplete) : (sessionState.streamComplete !== false));
  const stateRevision = Number.isInteger(overrides.stateRevision)
    ? overrides.stateRevision
    : (Number.isInteger(sessionState.stateRevision) ? sessionState.stateRevision : 1);
  const requestedLifecycle = overrides.lifecycle || props.lifecycle || 'draft';
  const lifecycle = !streamComplete && requestedLifecycle === 'draft'
    ? 'loading'
    : normalizeLifecycle(requestedLifecycle, 'draft');

  return {
    contractVersion: CONTRACT_VERSION,
    stateRevision,
    streamComplete,
    lifecycle,
    lifecycleAllowed: [...LIFECYCLE_STATES],
  };
}

function findLayerInputSpec(toolSpec, parameterName) {
  const inputs = getExecutionInputs(toolSpec).filter((input) => input.kind === 'layer');
  if (!inputs.length) return null;
  if (parameterName) {
    return inputs.find((input) => input.parameter === parameterName) || inputs[0];
  }
  return inputs[0];
}

function getSelectedFeatureIdsForLayer(sessionState = {}, layerId) {
  if (!layerId) return [];
  const raw = sessionState?.selection?.selectedFeaturesByLayerId?.[layerId];
  return Array.isArray(raw) ? [...new Set(raw.filter(Boolean))] : [];
}

function createLayerInputModel(props = {}, sessionState = {}, options = {}) {
  const componentId = props.componentId || 'layer-input';
  const toolKey = props.toolKey || '';
  const specMap = getToolSpecMap(options.toolCatalog);
  const toolSpec = specMap.get(toolKey) || null;
  const inputSpec = findLayerInputSpec(toolSpec, props.parameterName);
  const parameterName = props.parameterName || inputSpec?.parameter || 'Input Layer';
  const allowedGeometryTypes = Array.isArray(props.allowedGeometryTypes) && props.allowedGeometryTypes.length
    ? [...props.allowedGeometryTypes]
    : (Array.isArray(inputSpec?.geometryTypes) ? [...inputSpec.geometryTypes] : []);
  const selectionAware = inputSpec ? Boolean(inputSpec.selectionAware) : true;

  const layers = Array.isArray(sessionState?.layers) ? sessionState.layers : [];
  const candidates = filterCompatibleLayers(layers, {
    parameter: parameterName,
    kind: 'layer',
    geometryTypes: allowedGeometryTypes,
  });

  const preferredLayerId = props.selectedLayerId
    || sessionState?.selection?.activeLayerId
    || candidates.find((candidate) => candidate.compatible)?.id
    || candidates[0]?.id
    || null;
  const selectedCandidate = candidates.find((candidate) => candidate.id === preferredLayerId) || null;
  const selectedFeatureIds = getSelectedFeatureIdsForLayer(sessionState, selectedCandidate?.id);
  const rawScope = props.targetScope || props.scope || sessionState?.selection?.targetScope || 'layer';
  const targetScope = selectionAware && rawScope === 'selection' ? 'selection' : 'layer';

  const errors = [];
  if (!candidates.length) {
    errors.push('No layers available in current state.');
  } else if (!selectedCandidate) {
    errors.push(`Layer "${preferredLayerId}" was not found.`);
  } else if (!selectedCandidate.compatible) {
    errors.push(selectedCandidate.reason || 'Selected layer geometry is incompatible with this tool.');
  } else if (targetScope === 'selection' && selectedFeatureIds.length === 0) {
    errors.push('No selected features in the chosen layer.');
  }

  const streamComplete = props.streamComplete !== undefined
    ? Boolean(props.streamComplete)
    : (sessionState?.streamComplete !== false);
  let lifecycle = 'draft';
  if (!streamComplete) lifecycle = 'loading';
  else if (!candidates.length) lifecycle = 'empty';
  else if (errors.length > 0) lifecycle = 'invalid';
  else if (props.lifecycle) lifecycle = normalizeLifecycle(props.lifecycle, 'draft');

  return {
    ...createEnvelope(props, sessionState, { lifecycle, streamComplete }),
    type: 'LayerInput',
    componentId,
    toolKey,
    parameterName,
    allowedGeometryTypes,
    selectionAware,
    candidates,
    result: {
      layerId: selectedCandidate?.id || null,
      displayName: selectedCandidate?.displayName || null,
      geometryType: selectedCandidate?.primaryGeometryType || null,
      featureCount: selectedCandidate?.featureCount || 0,
      compatible: Boolean(selectedCandidate?.compatible),
      targetScope,
      selectedFeatureCount: selectedFeatureIds.length,
    },
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}

function createSpatialSelectionModel(props = {}, sessionState = {}) {
  const componentId = props.componentId || 'spatial-selection';
  const layers = Array.isArray(sessionState?.layers) ? sessionState.layers : [];
  const layerId = props.layerId || sessionState?.selection?.activeLayerId || layers[0]?.id || null;
  const layer = layers.find((candidate) => candidate?.id === layerId) || null;
  const mode = ['layer', 'selected_features', 'drawn_aoi'].includes(props.mode)
    ? props.mode
    : (sessionState?.selection?.targetScope === 'layer' ? 'layer' : 'selected_features');
  const emptySelectionPolicy = props.emptySelectionPolicy === 'fallback_to_layer'
    ? 'fallback_to_layer'
    : 'block';

  const rawFeatures = normalizeToFeatures(layer?.geojson);
  const features = rawFeatures.map((feature, index) => {
    const cloned = deepClone(feature);
    const id = ensureFeatureId(cloned, `${layerId || 'feature'}-${index + 1}`);
    const title = stringifyValue(cloned?.properties?.name) !== '—'
      ? stringifyValue(cloned.properties.name)
      : `Feature ${index + 1}`;
    return {
      id,
      index,
      title,
      geometryType: cloned?.geometry?.type || 'Unknown',
      properties: cloned?.properties || {},
    };
  });

  const featureIdSet = new Set(features.map((f) => f.id));
  const candidateSelectedIds = Array.isArray(props.selectedFeatureIds)
    ? props.selectedFeatureIds
    : getSelectedFeatureIdsForLayer(sessionState, layerId);
  const selectedFeatureIds = [...new Set(candidateSelectedIds.filter((id) => featureIdSet.has(id)))];
  const selectedSet = new Set(selectedFeatureIds);

  const items = features.map((feature) => ({
    ...feature,
    selected: selectedSet.has(feature.id),
  }));

  const totalFeatureCount = features.length;
  const effectiveFeatureCount = mode === 'selected_features'
    ? (selectedFeatureIds.length > 0
        ? selectedFeatureIds.length
        : (emptySelectionPolicy === 'fallback_to_layer' ? totalFeatureCount : 0))
    : totalFeatureCount;

  const errors = [];
  if (!layer) {
    errors.push('No layer available for selection.');
  } else if (mode === 'selected_features' && emptySelectionPolicy === 'block' && selectedFeatureIds.length === 0) {
    errors.push('Select at least one feature or switch scope to Whole Layer.');
  }

  const streamComplete = props.streamComplete !== undefined
    ? Boolean(props.streamComplete)
    : (sessionState?.streamComplete !== false);
  let lifecycle = 'draft';
  if (!streamComplete) lifecycle = 'loading';
  else if (!layer || totalFeatureCount === 0) lifecycle = 'empty';
  else if (errors.length > 0) lifecycle = 'invalid';

  return {
    ...createEnvelope(props, sessionState, { lifecycle, streamComplete }),
    type: 'SpatialSelection',
    componentId,
    layerId,
    layerName: layer?.displayName || layer?.name || layerId || 'Layer',
    mode,
    emptySelectionPolicy,
    items,
    result: {
      layerId,
      mode,
      selectedFeatureIds,
      effectiveFeatureCount,
      totalFeatureCount,
      valid: errors.length === 0,
    },
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}

function coerceParamValue(paramSpec, rawValue) {
  if (rawValue === undefined) return paramSpec.defaultValue;
  if (paramSpec.type === 'boolean') return Boolean(rawValue);
  if (paramSpec.type === 'int') {
    if (rawValue === '' || rawValue === null) return NaN;
    const parsed = typeof rawValue === 'number' ? Math.trunc(rawValue) : parseInt(String(rawValue).trim(), 10);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (paramSpec.type === 'float') {
    if (rawValue === '' || rawValue === null) return NaN;
    const parsed = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue).trim());
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  return rawValue;
}

function createToolParametersModel(props = {}, sessionState = {}, options = {}) {
  const componentId = props.componentId || 'tool-parameters';
  const toolKey = props.toolKey || '';
  const specMap = getToolSpecMap(options.toolCatalog);
  const toolSpec = specMap.get(toolKey) || null;
  const ToolClass = HEADLESS_TOOLS[toolKey] || null;
  const toolInstance = ToolClass ? new ToolClass() : null;
  const lockedParams = Array.isArray(props.lockedParams) ? [...props.lockedParams] : [];
  const showSpatialAssumptions = props.showSpatialAssumptions !== false;

  const sessionDraft = sessionState?.drafts?.[toolKey] || {};
  const mergedInputParams = {
    ...(props.draftParams || {}),
    ...sessionDraft,
  };

  const fields = (toolSpec?.parameters || []).map((paramSpec) => {
    let rawValue = Object.prototype.hasOwnProperty.call(mergedInputParams, paramSpec.name)
      ? mergedInputParams[paramSpec.name]
      : paramSpec.defaultValue;

    const isLayerParam = getExecutionInputs(toolSpec).some(
      (input) => input.kind === 'layer' && input.parameter === paramSpec.name
    );
    if (isLayerParam && (!rawValue || String(rawValue).trim() === '')) {
      rawValue = sessionState?.selection?.activeLayerId || sessionState?.layers?.[0]?.id || '';
    }

    const value = coerceParamValue(paramSpec, rawValue);
    return {
      name: paramSpec.name,
      description: paramSpec.description || '',
      type: paramSpec.type,
      defaultValue: paramSpec.defaultValue,
      value,
      options: Array.isArray(paramSpec.options) ? [...paramSpec.options] : null,
      min: paramSpec.min ?? null,
      max: paramSpec.max ?? null,
      required: Boolean(paramSpec.required),
      unit: paramSpec.unit || null,
      locked: lockedParams.includes(paramSpec.name),
      isLayerInput: isLayerParam,
    };
  });

  const resolvedParams = fields.reduce((acc, field) => {
    acc[field.name] = field.value;
    return acc;
  }, {});

  const targetScope = mergedInputParams.targetScope || sessionState?.selection?.targetScope || null;
  if (targetScope) {
    resolvedParams.targetScope = targetScope;
  }

  const errors = [];
  if (!toolSpec || !toolInstance) {
    errors.push(`Unsupported tool: ${toolKey || 'unknown'}.`);
  } else {
    const paramValidation = toolInstance.validateParameters(resolvedParams, { state: sessionState });
    errors.push(...paramValidation.errors);

    const execValidation = validateExecutionSpec(toolSpec, resolvedParams, sessionState);
    execValidation.errors.forEach((err) => {
      if (!errors.includes(err)) errors.push(err);
    });

    if (targetScope === 'selection') {
      const layerInput = findLayerInputSpec(toolSpec);
      const targetLayerId = layerInput ? resolvedParams[layerInput.parameter] : null;
      const selectedIds = getSelectedFeatureIdsForLayer(sessionState, targetLayerId);
      if (!selectedIds.length) {
        errors.push('No selected features in the chosen layer.');
      }
    }
  }

  const isDirty = fields.some((field) => field.value !== field.defaultValue);
  const streamComplete = props.streamComplete !== undefined
    ? Boolean(props.streamComplete)
    : (sessionState?.streamComplete !== false);
  let lifecycle = 'draft';
  if (!streamComplete) lifecycle = 'loading';
  else if (props.lifecycle === 'running') lifecycle = 'running';
  else if (errors.length > 0) lifecycle = 'invalid';
  else if (props.lifecycle) lifecycle = normalizeLifecycle(props.lifecycle, 'draft');

  const canExecute = Boolean(
    streamComplete &&
    toolSpec &&
    errors.length === 0 &&
    lifecycle !== 'running'
  );

  return {
    ...createEnvelope(props, sessionState, { lifecycle, streamComplete }),
    type: 'ToolParameters',
    componentId,
    toolKey,
    toolName: toolSpec?.name || toolKey,
    description: toolSpec?.description || '',
    fields,
    showSpatialAssumptions,
    spatialAssumptions: showSpatialAssumptions ? { ...SPATIAL_METADATA } : null,
    canExecute,
    result: {
      toolKey,
      params: resolvedParams,
      isDirty,
      validation: {
        ok: errors.length === 0,
        errors,
      },
    },
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}

function createSpatialResultModel(props = {}, sessionState = {}) {
  const componentId = props.componentId || 'spatial-result';
  const surfaceVariant = props.surfaceVariant === 'workspace' ? 'workspace' : 'compact';
  const attributeMode = props.attributeMode === 'selected' ? 'selected' : 'all';
  const layers = Array.isArray(sessionState?.layers) ? sessionState.layers : [];
  const requestedLayerIds = Array.isArray(props.layerIds) && props.layerIds.length
    ? props.layerIds
    : layers.map((layer) => layer.id);
  const visibleLayers = layers.filter((layer) => requestedLayerIds.includes(layer.id));
  const primaryOutputLayerId = props.primaryOutputLayerId
    || sessionState?.added?.[sessionState.added.length - 1]?.id
    || visibleLayers[visibleLayers.length - 1]?.id
    || null;
  const primaryLayer = layers.find((layer) => layer.id === primaryOutputLayerId) || visibleLayers[0] || null;
  const parentLayerId = primaryLayer?.geojson?.toolMetadata?.parentLayerId || null;
  const sourceLayer = parentLayerId ? layers.find((layer) => layer.id === parentLayerId) || null : null;

  const selectedFeatureIds = getSelectedFeatureIdsForLayer(sessionState, primaryLayer?.id);
  const attributeModel = primaryLayer
    ? getAttributeModel(
        {
          id: primaryLayer.id,
          geojson: primaryLayer.geojson,
          geometry: { label: primaryLayer.geometryType || 'Feature' },
        },
        {
          maxRows: props.maxRows || 25,
          mode: attributeMode,
          selectedFeatureIds,
        }
      )
    : {
        columns: [],
        rows: [],
        totalRows: 0,
        visibleRows: 0,
        hasMoreRows: false,
        hasAttributes: false,
        mode: attributeMode,
        selectedFeatureCount: 0,
        filteredFromTotalRows: 0,
      };

  const streamComplete = props.streamComplete !== undefined
    ? Boolean(props.streamComplete)
    : (sessionState?.streamComplete !== false);
  let lifecycle = 'completed';
  if (!streamComplete) lifecycle = 'loading';
  else if (!primaryLayer) lifecycle = 'empty';
  else if (props.lifecycle) lifecycle = normalizeLifecycle(props.lifecycle, 'completed');

  return {
    ...createEnvelope(props, sessionState, { lifecycle, streamComplete }),
    type: 'SpatialResult',
    componentId,
    surfaceVariant,
    attributeMode,
    primaryLayer: primaryLayer
      ? {
          id: primaryLayer.id,
          displayName: primaryLayer.displayName || primaryLayer.name || primaryLayer.id,
          geometryType: primaryLayer.geometryType || 'FeatureCollection',
          geojson: primaryLayer.geojson,
          parentLayerId,
          toolMetadata: primaryLayer.geojson?.toolMetadata || null,
          toolHistory: primaryLayer.geojson?.toolHistory || [],
        }
      : null,
    sourceLayer: sourceLayer
      ? {
          id: sourceLayer.id,
          displayName: sourceLayer.displayName || sourceLayer.name || sourceLayer.id,
          geometryType: sourceLayer.geometryType || 'FeatureCollection',
        }
      : null,
    visibleLayers: visibleLayers.map((layer) => ({
      id: layer.id,
      displayName: layer.displayName || layer.name || layer.id,
      geometryType: layer.geometryType || 'FeatureCollection',
      isPrimaryOutput: layer.id === primaryLayer?.id,
      isSourceLayer: layer.id === parentLayerId,
      geojson: layer.geojson,
    })),
    attributeModel,
    result: {
      primaryOutputLayerId: primaryLayer?.id || null,
      sourceLayerId: parentLayerId,
      visibleLayerIds: visibleLayers.map((layer) => layer.id),
      focusedFeatureId: props.focusedFeatureId || attributeModel.rows[0]?.id || null,
      attributeSummary: {
        totalRows: attributeModel.totalRows,
        visibleRows: attributeModel.visibleRows,
        columns: attributeModel.columns,
      },
    },
  };
}

function createExecutionReceiptModel(props = {}, runResponse = null, sessionState = {}) {
  const componentId = props.componentId || 'execution-receipt';
  const response = runResponse || props.response || null;
  const toolKey = response?.tool || props.toolKey || '';
  const streamComplete = props.streamComplete !== undefined
    ? Boolean(props.streamComplete)
    : (sessionState?.streamComplete !== false);

  if (!response) {
    return {
      ...createEnvelope(props, sessionState, {
        lifecycle: !streamComplete ? 'loading' : (props.lifecycle === 'running' ? 'running' : 'empty'),
        streamComplete,
      }),
      type: 'ExecutionReceipt',
      componentId,
      toolKey,
      grounded: false,
      canRerun: false,
      status: null,
      execution: null,
      spatial: {
        ...SPATIAL_METADATA,
        warnings: [],
      },
      artifacts: [],
      result: {
        grounded: false,
        ok: false,
        toolKey,
        warningCount: 0,
        artifactCount: 0,
      },
    };
  }

  const ok = Boolean(response.ok);
  const status = response.status || { code: ok ? 0 : 1, message: ok ? 'Executed.' : 'Execution failed.' };
  const execution = response.execution || {
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    inputLayerIds: [],
    outputLayerIds: Array.isArray(response?.state?.added) ? response.state.added.map((l) => l.id) : [],
    featureCounts: { input: 0, output: 0 },
    ...(response.target ? { target: response.target } : {}),
  };
  if (!execution.target && response.target) {
    execution.target = response.target;
  }

  const warnings = Array.isArray(response?.spatial?.warnings) ? response.spatial.warnings : [];
  const spatial = {
    ...SPATIAL_METADATA,
    ...(response.spatial || {}),
    warnings,
  };
  const artifacts = Array.isArray(response.artifacts) && response.artifacts.length
    ? response.artifacts
    : (Array.isArray(response?.output?.artifacts)
        ? response.output.artifacts
        : (response?.output?.download ? [{ type: 'download', ...response.output.download }] : []));

  let lifecycle = 'completed';
  if (!streamComplete) lifecycle = 'loading';
  else if (!ok) lifecycle = 'failed';
  else if (warnings.length > 0) lifecycle = 'partial';

  return {
    ...createEnvelope(props, sessionState, { lifecycle, streamComplete }),
    type: 'ExecutionReceipt',
    componentId,
    toolKey,
    grounded: true,
    canRerun: props.canRerun !== false,
    status,
    execution,
    spatial,
    artifacts,
    validation: response.validation || { ok, errors: ok ? [] : [status.message] },
    result: {
      grounded: true,
      ok,
      toolKey,
      statusCode: status.code,
      statusMessage: status.message,
      durationMs: execution.durationMs,
      inputLayerIds: execution.inputLayerIds || [],
      outputLayerIds: execution.outputLayerIds || [],
      featureCounts: execution.featureCounts || { input: 0, output: 0 },
      target: execution.target || null,
      warningCount: warnings.length,
      artifactCount: artifacts.length,
    },
  };
}

function createComponentEvent({
  eventType,
  componentId,
  stateRevision = 1,
  payload = {},
  timestamp = new Date().toISOString(),
} = {}) {
  if (!EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unsupported component eventType: ${eventType}`);
  }
  if (!componentId || typeof componentId !== 'string') {
    throw new Error('componentId is required for component events.');
  }

  return {
    contractVersion: CONTRACT_VERSION,
    eventType,
    componentId,
    stateRevision: Number.isInteger(stateRevision) ? stateRevision : 1,
    timestamp,
    payload: deepClone(payload) || {},
  };
}

function validateComponentEvent(event = {}) {
  const errors = [];
  if (!event || typeof event !== 'object') {
    return { ok: false, errors: ['Event must be an object.'] };
  }
  if (event.contractVersion !== CONTRACT_VERSION) {
    errors.push(`Unsupported contractVersion: ${event.contractVersion || 'missing'}. Expected ${CONTRACT_VERSION}.`);
  }
  if (!EVENT_TYPES.includes(event.eventType)) {
    errors.push(`Unsupported eventType: ${event.eventType || 'missing'}.`);
  }
  if (!event.componentId || typeof event.componentId !== 'string') {
    errors.push('Event componentId is required.');
  }
  if (!Number.isInteger(event.stateRevision) || event.stateRevision < 1) {
    errors.push('Event stateRevision must be a positive integer.');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function createFallbackComponentModel({
  componentId = 'fallback',
  requestedType = 'Unknown',
  requestedVersion = CONTRACT_VERSION,
  reason = 'Unsupported component or contract version.',
  sessionState = {},
} = {}) {
  return {
    ...createEnvelope({ lifecycle: 'invalid' }, sessionState, { lifecycle: 'invalid' }),
    type: 'FallbackComponent',
    componentId,
    requestedType,
    requestedVersion,
    reason,
    canExecute: false,
    validation: {
      ok: false,
      errors: [reason],
    },
  };
}

function createComponentRegistry() {
  const builders = new Map([
    ['LayerInput', (props, state, options) => createLayerInputModel(props, state, options)],
    ['SpatialSelection', (props, state) => createSpatialSelectionModel(props, state)],
    ['ToolParameters', (props, state, options) => createToolParametersModel(props, state, options)],
    ['SpatialResult', (props, state) => createSpatialResultModel(props, state)],
    ['ExecutionReceipt', (props, state, options) => createExecutionReceiptModel(props, options?.lastRunResponse || props?.response || null, state)],
  ]);

  return {
    version: CONTRACT_VERSION,
    listSupportedTypes() {
      return [...builders.keys()];
    },
    has(type) {
      return builders.has(type);
    },
    build(componentDescriptor = {}, sessionState = {}, options = {}) {
      const requestedVersion = componentDescriptor.contractVersion || options.contractVersion || CONTRACT_VERSION;
      const requestedType = componentDescriptor.type || 'Unknown';
      const componentId = componentDescriptor.componentId || componentDescriptor.id || `${requestedType}-1`;

      if (requestedVersion !== CONTRACT_VERSION) {
        return createFallbackComponentModel({
          componentId,
          requestedType,
          requestedVersion,
          reason: `Incompatible contractVersion "${requestedVersion}". Expected "${CONTRACT_VERSION}".`,
          sessionState,
        });
      }

      const builder = builders.get(requestedType);
      if (!builder) {
        return createFallbackComponentModel({
          componentId,
          requestedType,
          requestedVersion,
          reason: `Unregistered component type "${requestedType}". Allowed types: ${COMPONENT_TYPES.join(', ')}.`,
          sessionState,
        });
      }

      const streamComplete = componentDescriptor.streamComplete !== undefined
        ? Boolean(componentDescriptor.streamComplete)
        : (options.streamComplete !== undefined ? Boolean(options.streamComplete) : (sessionState?.streamComplete !== false));

      return builder(
        {
          ...componentDescriptor,
          componentId,
          streamComplete,
        },
        sessionState,
        options
      );
    },
  };
}

function resolveComposition(compositionDescriptor = {}, sessionState = {}, options = {}) {
  const registry = options.registry || createComponentRegistry();
  const contractVersion = compositionDescriptor.contractVersion || CONTRACT_VERSION;
  const layout = compositionDescriptor.layout === 'workspace' ? 'workspace' : 'compact';
  const streamComplete = compositionDescriptor.streamComplete !== undefined
    ? Boolean(compositionDescriptor.streamComplete)
    : (sessionState?.streamComplete !== false);
  const rawComponents = Array.isArray(compositionDescriptor.components) ? compositionDescriptor.components : [];

  if (contractVersion !== CONTRACT_VERSION) {
    const fallback = createFallbackComponentModel({
      componentId: 'composition-root',
      requestedType: 'Composition',
      requestedVersion: contractVersion,
      reason: `Incompatible composition contractVersion "${contractVersion}". Expected "${CONTRACT_VERSION}".`,
      sessionState,
    });
    return {
      ok: false,
      contractVersion: CONTRACT_VERSION,
      layout,
      streamComplete,
      stateRevision: sessionState?.stateRevision || 1,
      components: [fallback],
      errors: [fallback.reason],
    };
  }

  const components = rawComponents.map((descriptor, index) => registry.build(
    {
      ...descriptor,
      componentId: descriptor.componentId || descriptor.id || `${descriptor.type || 'component'}-${index + 1}`,
      contractVersion: descriptor.contractVersion || contractVersion,
      streamComplete: descriptor.streamComplete !== undefined ? descriptor.streamComplete : streamComplete,
    },
    sessionState,
    { ...options, contractVersion, streamComplete }
  ));

  const errors = components
    .filter((component) => component.type === 'FallbackComponent' || component.validation?.ok === false)
    .flatMap((component) => component.validation?.errors || []);

  return {
    ok: errors.length === 0,
    contractVersion: CONTRACT_VERSION,
    layout,
    streamComplete,
    stateRevision: sessionState?.stateRevision || 1,
    components,
    errors,
  };
}

module.exports = {
  CONTRACT_VERSION,
  LIFECYCLE_STATES,
  COMPONENT_TYPES,
  EVENT_TYPES,
  createHeadlessRuntime,
  createLayerInputModel,
  createSpatialSelectionModel,
  createToolParametersModel,
  createSpatialResultModel,
  createExecutionReceiptModel,
  createComponentEvent,
  validateComponentEvent,
  createFallbackComponentModel,
  createComponentRegistry,
  resolveComposition,
};
