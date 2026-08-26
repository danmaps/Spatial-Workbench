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
  geometryTypesFromGeojson,
  inputIsActive,
  getExecutionInputs,
  getInputLayerIds,
  validateExecutionSpec,
};
