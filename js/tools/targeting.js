function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeFeatureId(feature, fallbackId = null) {
  if (!feature || feature.type !== 'Feature') return fallbackId;
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
  const stableId = feature.properties.__id || feature.id || fallbackId;
  if (!stableId) return null;
  feature.properties.__id = stableId;
  if (feature.id === undefined || feature.id === null || feature.id === '') feature.id = stableId;
  return stableId;
}

function getFeatureCollectionFeatures(geojson, layerId) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection') {
    return (geojson.features || []).map((feature, index) => {
      const cloned = deepClone(feature);
      normalizeFeatureId(cloned, `${layerId || 'feature'}-${index + 1}`);
      return cloned;
    });
  }

  if (geojson.type === 'Feature') {
    const cloned = deepClone(geojson);
    normalizeFeatureId(cloned, `${layerId || 'feature'}-1`);
    return [cloned];
  }

  return [];
}

function pickLayerId(inputLayerId, contextState) {
  if (typeof inputLayerId === 'string' && inputLayerId.trim()) return inputLayerId;
  const selection = contextState && contextState.selection;
  if (selection && typeof selection.activeLayerId === 'string' && selection.activeLayerId.trim()) return selection.activeLayerId;
  const stateLayers = Array.isArray(contextState?.layers) ? contextState.layers : [];
  if (stateLayers.length && typeof stateLayers[0]?.id === 'string' && stateLayers[0].id.trim()) return stateLayers[0].id;
  const selectedLayerIds = Array.isArray(selection?.selectedLayerIds) ? selection.selectedLayerIds : [];
  return selectedLayerIds[0] || null;
}

function resolveTargetLayerData(inputLayerId, context = {}) {
  const state = context.state || {};
  const layerId = pickLayerId(inputLayerId, state);
  const resolveLayer = context.getLayer;
  const layer = typeof resolveLayer === 'function' && layerId ? resolveLayer(layerId) : null;
  const sourceGeoJSON = layer && typeof layer.toGeoJSON === 'function' ? deepClone(layer.toGeoJSON()) : null;

  if (!layer || !sourceGeoJSON) {
    return {
      ok: false,
      layerId,
      layer: null,
      sourceGeoJSON: null,
      targetGeoJSON: null,
      mode: 'missing',
      selectedFeatureIds: [],
      selectedFeatureCount: 0,
      totalFeatureCount: 0,
    };
  }

  const selection = state.selection || {};
  const selectedFeatureIds = Array.isArray(selection.selectedFeaturesByLayerId?.[layerId])
    ? Array.from(new Set(selection.selectedFeaturesByLayerId[layerId].filter(Boolean)))
    : [];

  const allFeatures = getFeatureCollectionFeatures(sourceGeoJSON, layerId);
  const totalFeatureCount = allFeatures.length;

  if (!selectedFeatureIds.length) {
    return {
      ok: true,
      layerId,
      layer,
      sourceGeoJSON,
      targetGeoJSON: sourceGeoJSON,
      mode: 'layer',
      selectedFeatureIds: [],
      selectedFeatureCount: 0,
      totalFeatureCount,
    };
  }

  const selectedSet = new Set(selectedFeatureIds);
  const selectedFeatures = allFeatures.filter((feature) => selectedSet.has(normalizeFeatureId(feature)));

  if (!selectedFeatures.length) {
    return {
      ok: true,
      layerId,
      layer,
      sourceGeoJSON,
      targetGeoJSON: sourceGeoJSON,
      mode: 'layer',
      selectedFeatureIds: [],
      selectedFeatureCount: 0,
      totalFeatureCount,
    };
  }

  return {
    ok: true,
    layerId,
    layer,
    sourceGeoJSON,
    targetGeoJSON: {
      type: 'FeatureCollection',
      features: selectedFeatures,
    },
    mode: 'selection',
    selectedFeatureIds,
    selectedFeatureCount: selectedFeatures.length,
    totalFeatureCount,
  };
}

module.exports = {
  resolveTargetLayerData,
};
