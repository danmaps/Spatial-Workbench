const { ensureFeatureId } = require('../spatial');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeFeatureCollection(input) {
  const fallback = { type: 'FeatureCollection', features: [] };
  const fc = clone(input && input.type === 'FeatureCollection' ? input : fallback);
  if (!Array.isArray(fc.features)) fc.features = [];
  fc.features.forEach((feature, index) => {
    if (!feature.properties) feature.properties = {};
    ensureFeatureId(feature, `feature-${index + 1}`);
  });
  return fc;
}

function normalizeHeadlessState(rawState) {
  const state = rawState || {};
  return {
    featureCollection: normalizeFeatureCollection(state.featureCollection),
    selection: {
      featureIds: Array.isArray(state.selection && state.selection.featureIds) ? [...state.selection.featureIds] : [],
    },
  };
}

function selectFeatureIds(state, preferredIds = []) {
  const explicit = preferredIds.filter(Boolean);
  if (explicit.length) return explicit;
  const selected = state.selection.featureIds.filter(Boolean);
  if (selected.length) return selected;
  return state.featureCollection.features.map((feature) => feature.properties.__id);
}

function updateFeatures(state, featureIds, updater) {
  const idSet = new Set(featureIds);
  let updatedCount = 0;

  const nextFeatureCollection = normalizeFeatureCollection(state.featureCollection);
  nextFeatureCollection.features = nextFeatureCollection.features.map((feature) => {
    const id = feature.properties.__id;
    if (!idSet.has(id)) return feature;
    const nextFeature = clone(feature);
    updater(nextFeature);
    updatedCount += 1;
    return nextFeature;
  });

  return {
    state: {
      featureCollection: nextFeatureCollection,
      selection: {
        featureIds: [...state.selection.featureIds],
      },
    },
    updatedCount,
  };
}

module.exports = {
  ensureFeatureId,
  normalizeFeatureCollection,
  normalizeHeadlessState,
  selectFeatureIds,
  updateFeatures,
};
