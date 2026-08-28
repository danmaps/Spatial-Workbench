function featuresFromGeoJSON(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection') return Array.isArray(geojson.features) ? geojson.features : [];
  if (geojson.type === 'Feature') return [geojson];
  return [];
}

function featureId(feature, layerId, index) {
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
  const id = feature.properties.__id || feature.id || `${layerId || 'feature'}-${index + 1}`;
  feature.properties.__id = id;
  return id;
}

function polygonFeatures(layer) {
  return featuresFromGeoJSON(layer?.toGeoJSON?.()).filter((feature) => (
    feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon'
  ));
}

function dissolvePolygons(features, turfLib) {
  if (!features.length) return null;
  return features.slice(1).reduce((mask, feature) => turfLib.union(mask, feature) || mask, features[0]);
}

function targetFeatures(targetGeoJSON) {
  return featuresFromGeoJSON(targetGeoJSON).filter((feature) => (
    feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon'
  ));
}

module.exports = { featuresFromGeoJSON, featureId, polygonFeatures, dissolvePolygons, targetFeatures };
