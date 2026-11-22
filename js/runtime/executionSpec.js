function geometryTypesFromGeojson(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection') {
    return [...new Set((geojson.features || []).flatMap((feature) => geometryTypesFromGeojson(feature)))];
  }
  if (geojson.type === 'Feature') return geometryTypesFromGeojson(geojson.geometry);
  if (geojson.type === 'GeometryCollection') {
    return [...new Set((geojson.geometries || []).flatMap((geometry) => geometryTypesFromGeojson(geometry)))];
  }
  return typeof geojson.type === 'string' ? [geojson.type] : [];
}

function inputIsActive(input, params = {}) {
  const condition = input?.when;
  return !condition || params[condition.parameter] === condition.equals;
}

function getExecutionInputs(spec = {}) {
  return Array.isArray(spec.execution?.inputs) ? spec.execution.inputs : [];
}

function getInputLayerIds(spec, params = {}) {
  return [...new Set(getExecutionInputs(spec)
    .filter((input) => input.kind === 'layer' && input.parameter && inputIsActive(input, params))
    .map((input) => params[input.parameter])
    .filter((value) => typeof value === 'string' && value))];
}

function getLayerGeometryTypes(layer = {}) {
  if (layer?.geojson) {
    const types = geometryTypesFromGeojson(layer.geojson);
    if (types.length) return types;
  }
  const declared = layer?.geometry?.type || layer?.geometryType || null;
  if (typeof declared === 'string' && declared && declared !== 'Layer' && declared !== 'FeatureCollection' && declared !== 'Mixed') {
    return [declared];
  }
  return [];
}

function getLayerFeatureCount(layer = {}) {
  if (Number.isFinite(layer?.geometry?.featureCount)) return layer.geometry.featureCount;
  if (Number.isFinite(layer?.featureCount)) return layer.featureCount;
  const geojson = layer?.geojson;
  if (!geojson || typeof geojson !== 'object') return 0;
  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features) ? geojson.features.length : 0;
  }
  if (geojson.type === 'Feature') return 1;
  return 0;
}

function filterCompatibleLayers(layers = [], inputSpec = {}) {
  const allowedTypes = Array.isArray(inputSpec?.geometryTypes) ? inputSpec.geometryTypes : [];
  const parameterLabel = inputSpec?.parameter || 'Layer';

  return (Array.isArray(layers) ? layers : []).map((layer) => {
    const id = layer?.id || '';
    const displayName = layer?.displayName || layer?.name || layer?.label || id || 'Layer';
    const geometryTypes = getLayerGeometryTypes(layer);
    const primaryGeometryType = geometryTypes.length === 1
      ? geometryTypes[0]
      : (geometryTypes.length > 1 ? 'Mixed' : (layer?.geometry?.type || layer?.geometryType || 'Unknown'));
    const featureCount = getLayerFeatureCount(layer);
    const incompatibleTypes = allowedTypes.length
      ? geometryTypes.filter((type) => !allowedTypes.includes(type))
      : [];
    const compatible = incompatibleTypes.length === 0 && (allowedTypes.length === 0 || geometryTypes.length > 0);
    const reason = !compatible
      ? (incompatibleTypes.length
          ? `${parameterLabel} only accepts ${allowedTypes.join(', ')} geometry; received ${incompatibleTypes.join(', ')}.`
          : `${parameterLabel} requires ${allowedTypes.join(', ')} geometry.`)
      : null;

    return {
      id,
      displayName,
      geometryTypes,
      primaryGeometryType,
      featureCount,
      compatible,
      incompatibleTypes,
      reason,
    };
  });
}

function validateExecutionSpec(spec, params = {}, state = {}) {
  const errors = [];
  const layers = Array.isArray(state.layers) ? state.layers : [];

  getExecutionInputs(spec).forEach((input) => {
    if (!inputIsActive(input, params) || !Array.isArray(input.geometryTypes) || input.geometryTypes.length === 0) return;
    if (input.kind === 'layer') {
      const layer = layers.find((candidate) => candidate?.id === params[input.parameter]);
      if (!layer?.geojson) return;
      const found = geometryTypesFromGeojson(layer.geojson);
      const incompatible = found.filter((type) => !input.geometryTypes.includes(type));
      if (incompatible.length) errors.push(input.parameter + ' only accepts ' + input.geometryTypes.join(', ') + ' geometry; received ' + incompatible.join(', ') + '.');
    }
    if (input.kind === 'featureCollection' && state.featureCollection) {
      const selectedIds = input.selectionAware && Array.isArray(state.selection?.featureIds) && state.selection.featureIds.length
        ? new Set(state.selection.featureIds) : null;
      const features = (state.featureCollection.features || []).filter((feature) => !selectedIds || selectedIds.has(feature?.properties?.__id));
      const found = [...new Set(features.flatMap((feature) => geometryTypesFromGeojson(feature)))];
      const incompatible = found.filter((type) => !input.geometryTypes.includes(type));
      if (incompatible.length) errors.push('Feature collection only accepts ' + input.geometryTypes.join(', ') + ' geometry; received ' + incompatible.join(', ') + '.');
    }
  });

  return { ok: errors.length === 0, errors };
}

module.exports = {
  filterCompatibleLayers,
  geometryTypesFromGeojson,
  inputIsActive,
  getExecutionInputs,
  getInputLayerIds,
  validateExecutionSpec,
};
