/* global L */

// Centralized app state helpers.
// This is intentionally lightweight (no framework). It gives agents and tools
// a single place to ask "what exists" and to apply results without directly
// mutating the map.

const _registry = new Map(); // stableId -> leaflet layer
let _layerRemoveListenerAttached = false;

// Counter to reduce collision risk in _uuid fallback when multiple IDs are generated
// in the same millisecond.
let _uuidCounter = 0;

function _uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: not RFC-perfect, but stable enough for local use.
  // Incorporates timestamp, random value, and a monotonically increasing counter
  // to minimize the chance of collisions in tight loops or batch operations.
  const timestampPart = Date.now().toString(16);
  const randomPart = Math.random().toString(16).slice(2);
  const counterPart = (_uuidCounter++ & 0xffffffff).toString(16);
  return 'id-' + timestampPart + '-' + randomPart + '-' + counterPart;
}

const DEBUG = (typeof process !== 'undefined' && process && process.env && process.env.NODE_ENV !== 'production');

function getAppRefs() {
  try {
    const app = require('./app');
    return {
      map: app && app.map ? app.map : null,
      drawnItems: app && app.drawnItems ? app.drawnItems : null,
      tocLayers: app && Array.isArray(app.tocLayers) ? app.tocLayers : null,
    };
  } catch (_) {
    return {
      map: null,
      drawnItems: null,
      tocLayers: null,
    };
  }
}

function getMap() {
  return getAppRefs().map;
}

function ensureLayerRemoveListener() {
  if (_layerRemoveListenerAttached) return;

  const { map } = getAppRefs();
  if (!map || typeof map.on !== 'function') return;

  map.on('layerremove', function (e) {
    const layer = e && e.layer;
    if (!layer || !layer.__id) return;

    const { map: currentMap, drawnItems: currentDrawnItems } = getAppRefs();

    // If the layer is still present on the map or in drawnItems, do not unregister it.
    if (currentMap && currentMap.hasLayer && currentMap.hasLayer(layer)) return;
    if (currentDrawnItems && currentDrawnItems.hasLayer && currentDrawnItems.hasLayer(layer)) return;

    unregisterLayer(layer);
  });

  _layerRemoveListenerAttached = true;
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
  ensureLayerRemoveListener();
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
  ensureLayerRemoveListener();
  const layer = getLayer(id);
  if (!layer) return false;
  const { drawnItems, map, tocLayers } = getAppRefs();

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
  ensureLayerRemoveListener();
  const { tocLayers } = getAppRefs();
  // Prefer TOC list (it reflects "layers we care about").
  const layers = Array.isArray(tocLayers) ? tocLayers : [];
  return layers.map((layer) => {
    // Ensure the layer is both ID'd and registered.
    const preferredId = layer?.feature?.properties?.__id;
    const id = registerLayer(layer, preferredId);
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
  ensureLayerRemoveListener();
  const layers = listLayers();
  const { map } = getAppRefs();
  return {
    layerCount: layers.length,
    layers,
    bounds: map && map.getBounds ? map.getBounds() : null,
  };
}

// ToolResult is intentionally minimal for now.
// { addGeojson?: Feature|FeatureCollection|Array<Feature|FeatureCollection>, removeLayerIds?: string[] }
function applyResult(toolResult) {
  ensureLayerRemoveListener();
  if (!toolResult || typeof toolResult !== 'object') return { ok: false, added: [], removed: [], errors: ['invalid toolResult'] };

  const added = [];
  const removed = [];
  const errors = [];
  const { drawnItems, map, tocLayers } = getAppRefs();

  // Removals
  const toRemove = toolResult.removeLayerIds || [];
  for (const id of toRemove) {
    if (removeLayer(id)) removed.push(id);
  }

  // Additions
  let toAdd = toolResult.addGeojson;
  if (!toAdd) return { ok: true, added, removed, errors };
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

        // Apply any tool metadata stored on the GeoJSON (prefer top-level, but accept per-feature too).
        try {
          const md = (gj && gj.toolMetadata) || (child.feature && child.feature.toolMetadata) || (child.feature && child.feature.properties && child.feature.properties.toolMetadata);
          if (child.feature && md) child.feature.toolMetadata = md;
        } catch (e) {
          if (DEBUG) console.warn('applyResult: toolMetadata attach failed', e);
        }

        // Add to map + editable group
        try { child.addTo(map); } catch (e) { if (DEBUG) console.warn('applyResult: map add failed', e); }
        try { drawnItems.addLayer(child); } catch (e) { if (DEBUG) console.warn('applyResult: drawnItems add failed', e); }

        // Track in TOC
        if (Array.isArray(tocLayers) && !tocLayers.includes(child)) tocLayers.push(child);

        added.push(child.__id);
      });
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
      if (DEBUG) console.warn('applyResult: addGeojson failed', e);
    }
  }

  return { ok: errors.length === 0, added, removed, errors };
}

module.exports = {
  ensureStableId,
  registerLayer,
  getLayer,
  getMap,
  listLayers,
  getState,
  applyResult,
  removeLayer,
};
