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
  return features.slice(1).reduce((mask, feature) => unionPolygons(mask, feature, turfLib) || mask, features[0]);
}

// Turf 6 accepts two polygon arguments; Turf 7 accepts a FeatureCollection.
// Keep the tool usable with either browser CDN/runtime without swallowing the
// API mismatch as a misleading "no intersecting features" result.
function unionPolygons(first, second, turfLib) {
  try {
    return turfLib.union(first, second);
  } catch (error) {
    if (typeof turfLib.featureCollection !== 'function') throw error;
    return turfLib.union(turfLib.featureCollection([first, second]));
  }
}

function intersectPolygons(first, second, turfLib) {
  try {
    return turfLib.intersect(first, second);
  } catch (error) {
    if (typeof turfLib.featureCollection !== 'function') throw error;
    return turfLib.intersect(turfLib.featureCollection([first, second]));
  }
}

function targetFeatures(targetGeoJSON) {
  return featuresFromGeoJSON(targetGeoJSON).filter((feature) => (
    feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon'
  ));
}

module.exports = { featuresFromGeoJSON, featureId, polygonFeatures, dissolvePolygons, intersectPolygons, targetFeatures, unionPolygons };
