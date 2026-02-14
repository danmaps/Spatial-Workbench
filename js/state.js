/* global L */

// Centralized app state helpers.
// This is intentionally lightweight (no framework). It gives agents and tools
// a single place to ask "what exists" and to apply results without directly
// mutating the map.

const { drawnItems, map, tocLayers } = require('./app');

const _registry = new Map(); // stableId -> leaflet layer

function _uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: not RFC-perfect, but stable enough for local use.
  return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function ensureStableId(layer, preferredId) {
  if (!layer) return null;

  // Persist on the layer instance.
  if (!layer.__id) layer.__id = preferredId || _uuid();

  // Persist on GeoJSON feature properties.
  // Leaflet.Draw-created layers often don't have .feature; ensure it exists.
  if (!layer.feature) {
    layer.feature = { type: 'Feature', properties: {} };
  }
  if (!layer.feature.properties) layer.feature.properties = {};
  if (!layer.feature.properties.__id) layer.feature.properties.__id = layer.__id;

  return layer.__id;
}

function registerLayer(layer, preferredId) {
  const id = ensureStableId(layer, preferredId);
  if (!id) return null;
  _registry.set(id, layer);
  return id;
}

function unregisterLayer(layerOrId) {
  const id = typeof layerOrId === 'string' ? layerOrId : (layerOrId && layerOrId.__id);
  if (!id) return;
  _registry.delete(id);
}

function getLayer(id) {
  return _registry.get(id) || null;
}

function removeLayer(id) {
  const layer = getLayer(id);
  if (!layer) return false;

  try {
    if (drawnItems && drawnItems.hasLayer && drawnItems.hasLayer(layer)) {
      drawnItems.removeLayer(layer);
    }
    if (map && map.removeLayer) {
      map.removeLayer(layer);
    }
  } catch (_) {
    // best-effort
  }

  // Remove from TOC list if present
  try {
    const idx = tocLayers.indexOf(layer);
    if (idx >= 0) tocLayers.splice(idx, 1);
  } catch (_) {}

  unregisterLayer(id);
  return true;
}

function listLayers() {
  // Prefer TOC list (it reflects "layers we care about").
  const layers = Array.isArray(tocLayers) ? tocLayers : [];
  return layers.map((layer) => {
    const id = ensureStableId(layer);
    const geo = (layer && typeof layer.toGeoJSON === 'function') ? layer.toGeoJSON() : null;
    const geomType = geo && geo.geometry ? geo.geometry.type : (layer && layer.featureType) || null;
    return {
      id,
      geometryType: geomType,
      // Best-effort label. Tools can choose to display id or a friendlier string.
      label: geomType ? `${geomType} (${id})` : id,
    };
  });
}

function getState() {
  const layers = listLayers();
  return {
    layerCount: layers.length,
    layers,
    bounds: map && map.getBounds ? map.getBounds() : null,
  };
}

// ToolResult is intentionally minimal for now.
// { addGeojson?: Feature|FeatureCollection|Array<Feature|FeatureCollection>, removeLayerIds?: string[] }
function applyResult(toolResult) {
  if (!toolResult || typeof toolResult !== 'object') return { ok: false, added: [], removed: [] };

  const added = [];
  const removed = [];

  // Removals
  const toRemove = toolResult.removeLayerIds || [];
  for (const id of toRemove) {
    if (removeLayer(id)) removed.push(id);
  }

  // Additions
  let toAdd = toolResult.addGeojson;
  if (!toAdd) return { ok: true, added, removed };
  if (!Array.isArray(toAdd)) toAdd = [toAdd];

  for (const gj of toAdd) {
    try {
      const layer = L.geoJSON(gj);
      layer.eachLayer((child) => {
        // Pull through any existing __id from feature, otherwise mint one.
        const preferredId = child?.feature?.properties?.__id;
        const id = registerLayer(child, preferredId);
        // Ensure the feature property is set even if Leaflet didn't attach it yet.
        ensureStableId(child, preferredId || id);

        // Apply any tool metadata stored on the GeoJSON feature (used by TOC hookup)
        try {
          if (child.feature && gj && gj.toolMetadata) {
            child.feature.toolMetadata = gj.toolMetadata;
          }
          if (child.feature && child.feature.toolMetadata) {
            // no-op; already attached
          }
        } catch (_) {}

        // Add to map + editable group
        try { child.addTo(map); } catch (_) {}
        try { drawnItems.addLayer(child); } catch (_) {}

        // Track in TOC
        if (!tocLayers.includes(child)) tocLayers.push(child);

        added.push(child.__id);
      });
    } catch (_) {
      // best-effort
    }
  }

  return { ok: true, added, removed };
}

module.exports = {
  ensureStableId,
  registerLayer,
  getLayer,
  listLayers,
  getState,
  applyResult,
  removeLayer,
};
