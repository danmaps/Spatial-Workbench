/* global L */

// Centralized app state helpers.
// This is intentionally lightweight (no framework). It gives agents and tools
// a single place to ask "what exists" and to apply results without directly
// mutating the map.

const { createExpressionFromToolHistory } = require('./runtime/spatialExpression');
const { getFeatureSymbologyStyle } = require('./ui/selection-style');
const { validateSymbology, getSymbologyDomain, createSymbologyResolver } = require('./ui/layer-symbology');

const _registry = new Map(); // stableId -> leaflet layer
const _layerSymbology = new WeakMap();
const _originalVisuals = new WeakMap();
const _symbologyCache = new WeakMap();
let _layerRemoveListenerAttached = false;

const _selectionState = {
  activeLayerId: null,
  selectedLayerIds: new Set(),
  selectedFeaturesByLayerId: new Map(),
};

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

function ensureDatasetId(layer, preferredDatasetId) {
  if (!layer) return null;

  if (!layer.__datasetId) layer.__datasetId = preferredDatasetId || layer.__id || _uuid();

  const feature = ensureLayerFeature(layer);
  if (!feature.properties.__datasetId) {
    feature.properties.__datasetId = layer.__datasetId;
  }

  return layer.__datasetId;
}

function ensureLayerRemoveListener() {
  if (_layerRemoveListenerAttached) return;

  const { map } = getAppRefs();
  if (!map || typeof map.on !== 'function') return;

  map.on('layerremove', function (e) {
    const layer = e && e.layer;
    if (!layer || !layer.__id) return;

    // A visibility toggle intentionally removes a layer from Leaflet while
    // keeping it in the registry/TOC. Deletion still unregisters normally.
    if (layer.__isVisible === false) return;

    const { map: currentMap, drawnItems: currentDrawnItems } = getAppRefs();

    // If the layer is still present on the map or in drawnItems, do not unregister it.
    if (currentMap && currentMap.hasLayer && currentMap.hasLayer(layer)) return;
    if (currentDrawnItems && currentDrawnItems.hasLayer && currentDrawnItems.hasLayer(layer)) return;

    unregisterLayer(layer);
  });

  _layerRemoveListenerAttached = true;
}

function ensureLayerFeature(layer) {
  if (!layer.feature) {
    layer.feature = { type: 'Feature', properties: {} };
  }
  if (!layer.feature.properties) layer.feature.properties = {};
  return layer.feature;
}

function ensureStableId(layer, preferredId) {
  if (!layer) return null;

  // Persist on the layer instance.
  if (!layer.__id) layer.__id = preferredId || _uuid();

  // Persist on GeoJSON feature properties.
  const feature = ensureLayerFeature(layer);
  if (!feature.properties.__id) feature.properties.__id = layer.__id;
  ensureDatasetId(layer);

  return layer.__id;
}

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  return JSON.parse(JSON.stringify(metadata));
}

function ensureFeatureIdentifiers(geojson, baseId) {
  if (!geojson || typeof geojson !== 'object') return geojson;

  const assignId = (feature, fallbackId) => {
    if (!feature || feature.type !== 'Feature') return;
    if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
    const existingId = feature.properties.__id || feature.id;
    const stableId = existingId || fallbackId || _uuid();
    feature.properties.__id = stableId;
    if (feature.id === undefined || feature.id === null || feature.id === '') feature.id = stableId;
  };

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    geojson.features.forEach((feature, index) => assignId(feature, `${baseId || 'feature'}-${index + 1}`));
    return geojson;
  }

  if (geojson.type === 'Feature') {
    assignId(geojson, baseId || 'feature-1');
  }

  return geojson;
}

function sanitizeMetadata(metadata) {
  const cloned = cloneMetadata(metadata);
  if (!cloned) return null;

  if (cloned.params && typeof cloned.params === 'object') {
    if (cloned.params.Input && typeof cloned.params.Input === 'object' && cloned.params.Input.name) {
      cloned.params.Input = cloned.params.Input.name;
    }
  }

  return cloned;
}

function getToolMetadata(layer) {
  if (!layer || !layer.feature) return null;
  return layer.feature.toolMetadata || layer.feature.properties?.toolMetadata || null;
}

function ensureToolHistory(layer, metadata, options = {}) {
  if (!layer) return [];

  const feature = ensureLayerFeature(layer);
  const properties = feature.properties || (feature.properties = {});

  let history = Array.isArray(properties.toolHistory)
    ? properties.toolHistory.map((entry) => cloneMetadata(entry)).filter(Boolean)
    : [];

  if (!history.length && Array.isArray(feature.toolHistory)) {
    history = feature.toolHistory.map((entry) => cloneMetadata(entry)).filter(Boolean);
  }

  const sourceMetadata = sanitizeMetadata(metadata || getToolMetadata(layer));
  const inheritFromLayer = options.inheritFromLayer || null;
  const seenKeys = new Set();
  const merged = [];

  function pushUnique(entry) {
    if (!entry) return;
    const key = JSON.stringify(entry);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    merged.push(entry);
  }

  if (inheritFromLayer) {
    const parentHistory = getToolHistory(inheritFromLayer);
    parentHistory.forEach(pushUnique);
  }

  history.forEach(pushUnique);
  if (sourceMetadata) pushUnique(sourceMetadata);

  properties.toolHistory = merged;
  feature.toolHistory = merged;

  if (sourceMetadata) {
    feature.toolMetadata = sourceMetadata;
    properties.toolMetadata = sourceMetadata;
  }

  return merged;
}

function normalizeLayerIds(layerIds) {
  if (!Array.isArray(layerIds)) return [];

  const seen = new Set();
  const normalized = [];
  layerIds.forEach((id) => {
    if (typeof id !== 'string' || !id.trim()) return;
    if (!_registry.has(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });

  return normalized;
}

function cloneSelectedFeaturesByLayerId() {
  const cloned = {};
  _selectionState.selectedFeaturesByLayerId.forEach((featureIds, layerId) => {
    cloned[layerId] = Array.from(featureIds);
  });
  return cloned;
}

function getActiveLayerId() {
  return _selectionState.activeLayerId;
}

function setActiveLayerId(layerId) {
  if (layerId === null || layerId === undefined || layerId === '') {
    _selectionState.activeLayerId = null;
    return null;
  }

  if (typeof layerId !== 'string' || !_registry.has(layerId)) return _selectionState.activeLayerId;

  _selectionState.activeLayerId = layerId;
  return _selectionState.activeLayerId;
}

function getSelectedLayerIds() {
  return Array.from(_selectionState.selectedLayerIds);
}

function setSelectedLayerIds(layerIds) {
  const normalized = normalizeLayerIds(layerIds);
  _selectionState.selectedLayerIds = new Set(normalized);

  if (_selectionState.activeLayerId && !_selectionState.selectedLayerIds.has(_selectionState.activeLayerId)) {
    _selectionState.activeLayerId = normalized[0] || null;
  }

  if (!_selectionState.activeLayerId && normalized.length) {
    _selectionState.activeLayerId = normalized[0];
  }

  return getSelectedLayerIds();
}

function isLayerSelected(layerId) {
  return _selectionState.selectedLayerIds.has(layerId);
}

function selectLayer(layerId, options = {}) {
  if (typeof layerId !== 'string' || !_registry.has(layerId)) return getSelectedLayerIds();

  _selectionState.selectedLayerIds.add(layerId);
  if (options.makeActive || !_selectionState.activeLayerId) {
    _selectionState.activeLayerId = layerId;
  }

  return getSelectedLayerIds();
}

function deselectLayer(layerId) {
  _selectionState.selectedLayerIds.delete(layerId);
  if (_selectionState.activeLayerId === layerId) {
    _selectionState.activeLayerId = getSelectedLayerIds()[0] || null;
  }
  return getSelectedLayerIds();
}

function toggleLayerSelection(layerId, options = {}) {
  if (isLayerSelected(layerId)) return deselectLayer(layerId);
  return selectLayer(layerId, options);
}

function clearLayerSelection() {
  _selectionState.selectedLayerIds.clear();
  _selectionState.activeLayerId = null;
  return [];
}

function getSelectedFeaturesByLayerId() {
  return cloneSelectedFeaturesByLayerId();
}

function getSelectedFeatureIds(layerId) {
  if (typeof layerId !== 'string') return [];
  return Array.from(_selectionState.selectedFeaturesByLayerId.get(layerId) || []);
}

function setSelectedFeatureIds(layerId, featureIds) {
  if (typeof layerId !== 'string' || !_registry.has(layerId)) return getSelectedFeatureIds(layerId);

  const normalized = Array.isArray(featureIds)
    ? Array.from(new Set(featureIds.filter((id) => id !== null && id !== undefined && id !== '')))
    : [];

  if (!normalized.length) {
    _selectionState.selectedFeaturesByLayerId.delete(layerId);
    return [];
  }

  _selectionState.selectedFeaturesByLayerId.set(layerId, new Set(normalized));
  return getSelectedFeatureIds(layerId);
}

function clearSelectedFeatureIds(layerId) {
  if (typeof layerId === 'string') {
    _selectionState.selectedFeaturesByLayerId.delete(layerId);
    return {};
  }

  _selectionState.selectedFeaturesByLayerId.clear();
  return {};
}

function focusLayerSelection(layerId) {
  if (typeof layerId !== 'string' || !_registry.has(layerId)) return null;

  _selectionState.selectedLayerIds = new Set([layerId]);
  _selectionState.activeLayerId = layerId;
  clearSelectedFeatureIds();
  return layerId;
}

function registerLayer(layer, preferredId, preferredDatasetId) {
  ensureLayerRemoveListener();
  const id = ensureStableId(layer, preferredId);
  ensureDatasetId(layer, preferredDatasetId);
  if (!id) return null;
  _registry.set(id, layer);
  return id;
}

function unregisterLayer(layerOrId) {
  const id = typeof layerOrId === 'string' ? layerOrId : (layerOrId && layerOrId.__id);
  if (!id) return;
  _registry.delete(id);
  _selectionState.selectedLayerIds.delete(id);
  _selectionState.selectedFeaturesByLayerId.delete(id);
  if (_selectionState.activeLayerId === id) {
    _selectionState.activeLayerId = getSelectedLayerIds()[0] || null;
  }
}

function getLayer(id) {
  return _registry.get(id) || null;
}

function symbologyLayer(layerOrId) {
  return typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
}

function visitVisualLayers(layer, callback, inheritedFeature) {
  if (!layer) return;
  const isGroup = typeof layer.eachLayer === 'function';
  const feature = layer.feature && (!isGroup || layer.feature.geometry) ? layer.feature : inheritedFeature;
  if (isGroup) {
    layer.eachLayer((child) => visitVisualLayers(child, callback, feature));
  } else if (feature) {
    callback(layer, feature);
  }
}

function rememberVisual(layer) {
  if (_originalVisuals.has(layer)) return;
  const options = layer.options || {};
  const style = {};
  ['color', 'fillColor', 'opacity', 'fillOpacity', 'weight', 'dashArray'].forEach((key) => {
    if (options[key] !== undefined) style[key] = options[key];
  });
  if (!Object.prototype.hasOwnProperty.call(style, 'dashArray')) style.dashArray = null;
  _originalVisuals.set(layer, {
    style,
    icon: typeof layer.getIcon === 'function' ? layer.getIcon() : options.icon,
    opacity: options.opacity,
    radius: typeof layer.getRadius === 'function' ? layer.getRadius() : undefined,
    symbologyStyle: layer.__symbologyStyle,
  });
}

function paintSymbology(layer, spec, domain) {
  const resolve = createSymbologyResolver(spec, domain);
  visitVisualLayers(layer, (visual, feature) => {
    rememberVisual(visual);
    const style = resolve(feature);
    if (typeof visual.setStyle === 'function') {
      visual.setStyle({ color: style.color, fillColor: style.fillColor, opacity: style.opacity, fillOpacity: style.fillOpacity, weight: style.weight, dashArray: null });
      if (typeof L !== 'undefined' && typeof L.CircleMarker === 'function'
        && visual instanceof L.CircleMarker && !(typeof L.Circle === 'function' && visual instanceof L.Circle)) {
        visual.setRadius(style.radius);
      }
      visual.__symbologyStyle = style;
    } else if (typeof visual.setIcon === 'function' && typeof L !== 'undefined' && typeof L.divIcon === 'function') {
      // Retain the marker itself so dragging, popups and click handlers survive.
      const size = 2 * (style.radius + style.weight / 2);
      const center = size / 2;
      visual.setIcon(L.divIcon({
        className: 'layer-symbology-marker',
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${center}" cy="${center}" r="${style.radius}" fill="${style.fillColor}" fill-opacity="${style.fillOpacity}" stroke="${style.color}" stroke-opacity="${style.opacity}" stroke-width="${style.weight}"/></svg>`,
        iconSize: [size, size],
        iconAnchor: [center, center],
      }));
      if (typeof visual.setOpacity === 'function') visual.setOpacity(1);
    }
  });
}

function getLayerSymbology(layerOrId) {
  const layer = symbologyLayer(layerOrId);
  const spec = layer && _layerSymbology.get(layer);
  return spec ? { ...spec, paint: { ...spec.paint } } : null;
}

function getLayerSymbologyDomain(layerOrId) {
  const layer = symbologyLayer(layerOrId);
  const spec = layer && _layerSymbology.get(layer);
  if (!spec) return { fallbackUsed: false };
  const geojson = typeof layer.toGeoJSON === 'function' ? layer.toGeoJSON() : layer.feature;
  const signature = JSON.stringify(geojson);
  const visuals = [];
  visitVisualLayers(layer, (visual) => visuals.push(visual));
  const cached = _symbologyCache.get(layer);
  if (cached && cached.signature === signature && cached.visuals.length === visuals.length
    && visuals.every((visual, index) => visual === cached.visuals[index])) {
    return JSON.parse(JSON.stringify(cached.domain));
  }
  const domain = getSymbologyDomain(geojson, spec);
  paintSymbology(layer, spec, domain);
  _symbologyCache.set(layer, { signature, visuals, domain });
  return JSON.parse(JSON.stringify(domain));
}

function setLayerSymbology(layerOrId, inputSpec) {
  const layer = symbologyLayer(layerOrId);
  if (!layer || typeof layer !== 'object') throw new TypeError('Layer not found');
  const spec = validateSymbology(inputSpec);
  _layerSymbology.set(layer, spec);
  _symbologyCache.delete(layer);
  getLayerSymbologyDomain(layer);
  return { ...spec, paint: { ...spec.paint } };
}

function resetLayerSymbology(layerOrId) {
  const layer = symbologyLayer(layerOrId);
  if (!layer) return null;
  visitVisualLayers(layer, (visual) => {
    const original = _originalVisuals.get(visual);
    if (!original) return;
    if (typeof visual.setStyle === 'function') {
      visual.setStyle(original.style);
      if (typeof L !== 'undefined' && typeof L.CircleMarker === 'function'
        && visual instanceof L.CircleMarker && !(typeof L.Circle === 'function' && visual instanceof L.Circle)
        && original.radius !== undefined) visual.setRadius(original.radius);
      if (original.symbologyStyle === undefined) delete visual.__symbologyStyle;
      else visual.__symbologyStyle = original.symbologyStyle;
    } else if (typeof visual.setIcon === 'function' && original.icon) {
      visual.setIcon(original.icon);
      if (typeof visual.setOpacity === 'function' && original.opacity !== undefined) visual.setOpacity(original.opacity);
    }
    _originalVisuals.delete(visual);
  });
  _layerSymbology.delete(layer);
  _symbologyCache.delete(layer);
  return null;
}

function getLayersByDatasetId(datasetId) {
  if (!datasetId) return [];
  ensureLayerRemoveListener();
  const { tocLayers } = getAppRefs();
  const layers = Array.isArray(tocLayers) ? tocLayers : [];
  const matches = [];

  layers.forEach((layer) => {
    if (ensureDatasetId(layer) !== datasetId) return;

    if (typeof layer.eachLayer === 'function') {
      layer.eachLayer((child) => {
        if (!child?.feature) return;
        ensureStableId(child, child?.feature?.properties?.__id);
        ensureDatasetId(child, datasetId);
        matches.push(child);
      });
      return;
    }

    matches.push(layer);
  });

  return matches;
}

function getGeometryType(layer) {
  const geo = (layer && typeof layer.toGeoJSON === 'function') ? layer.toGeoJSON() : null;
  if (!geo) return (layer && layer.featureType) || null;
  if (geo.geometry) return geo.geometry.type;
  // FeatureCollection (group layer) – derive a summary geometry type
  if (geo.type === 'FeatureCollection' && Array.isArray(geo.features) && geo.features.length > 0) {
    const types = new Set(geo.features.map(f => f && f.geometry && f.geometry.type).filter(Boolean));
    if (types.size === 1) return types.values().next().value;
    return 'Mixed';
  }
  return (layer && layer.featureType) || null;
}

function getGeometryLabel(geometryType) {
  const type = geometryType || 'Layer';
  if (type === 'Point' || type === 'MultiPoint') return 'Point';
  if (type === 'LineString' || type === 'MultiLineString') return 'Line';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'Polygon';
  return type;
}

function getFeatureCountFromGeoJSON(geojson) {
  if (!geojson) return 0;
  if (geojson.type === 'FeatureCollection') return Array.isArray(geojson.features) ? geojson.features.length : 0;
  return 1;
}

function getLayerBounds(layer) {
  if (!layer) return null;
  try {
    if (typeof layer.getBounds === 'function') {
      const bounds = layer.getBounds();
      if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) return bounds;
    }
  } catch (_) {}

  try {
    if (typeof layer.getLatLng === 'function') {
      const latlng = layer.getLatLng();
      if (latlng && typeof L !== 'undefined' && L && typeof L.latLngBounds === 'function') {
        return L.latLngBounds([latlng, latlng]);
      }
    }
  } catch (_) {}

  return null;
}

function getToolHistory(layer) {
  if (!layer || !layer.feature) return [];
  const history = layer.feature.properties?.toolHistory || layer.feature.toolHistory || [];
  return Array.isArray(history) ? history.map((entry) => cloneMetadata(entry)).filter(Boolean) : [];
}

function getLayerWorkflowExpression(layerOrId, options = {}) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return null;
  const history = getToolHistory(layer);
  const expr = createExpressionFromToolHistory(history, {
    targetLayerId: options.targetLayerId || undefined,
    state: options.state || { layers: [] },
    chainSteps: options.chainSteps !== false,
    preserveSelectionScope: options.preserveSelectionScope === true,
  });
  return expr.steps.length > 0 ? expr : null;
}

function getLayerName(layerOrId) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return '';

  const feature = ensureLayerFeature(layer);
  const properties = feature.properties || {};
  return [
    properties.name,
    properties.title,
    properties.layerName,
    feature.properties?.displayName,
  ].find((value) => typeof value === 'string' && value.trim()) || '';
}

function setLayerName(layerOrId, name) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return false;

  const feature = ensureLayerFeature(layer);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  feature.properties.name = trimmed;
  feature.properties.layerName = trimmed;
  feature.properties.displayName = trimmed;
  return true;
}

const _collapsedGroupLayerIds = new Set();

function isLayerGroupCollapsed(layerId) {
  return Boolean(layerId && _collapsedGroupLayerIds.has(layerId));
}

function setLayerGroupCollapsed(layerId, collapsed) {
  if (!layerId) return false;
  const next = Boolean(collapsed);
  if (next) _collapsedGroupLayerIds.add(layerId);
  else _collapsedGroupLayerIds.delete(layerId);
  return next;
}

function toggleLayerGroupCollapsed(layerId) {
  if (!layerId) return false;
  return setLayerGroupCollapsed(layerId, !isLayerGroupCollapsed(layerId));
}

function getChildLayerIds(parentId) {
  if (!parentId) return [];

  const ids = [];
  _registry.forEach((layer, id) => {
    const metadata = getToolMetadata(layer);
    if (metadata?.parentLayerId === parentId) ids.push(id);
  });

  return ids;
}

function getTocLayerHierarchy() {
  ensureLayerRemoveListener();
  const { tocLayers } = getAppRefs();
  const rawLayers = Array.isArray(tocLayers) ? tocLayers : [];

  const entries = rawLayers.map((layer) => {
    const preferredId = layer?.feature?.properties?.__id;
    const preferredDatasetId = layer?.feature?.properties?.__datasetId;
    const id = registerLayer(layer, preferredId, preferredDatasetId);
    const info = getLayerInfo(layer);
    const parentLayerId = info?.source?.parentLayerId || null;
    return {
      id,
      layer,
      info,
      parentLayerId,
    };
  });

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const childrenByParentId = new Map();
  const roots = [];

  entries.forEach((entry) => {
    const parentId = entry.parentLayerId;
    if (parentId && parentId !== entry.id && entryById.has(parentId)) {
      if (!childrenByParentId.has(parentId)) {
        childrenByParentId.set(parentId, []);
      }
      childrenByParentId.get(parentId).push(entry);
    } else {
      roots.push(entry);
    }
  });

  const ordered = [];
  const visited = new Set();

  function visit(entry, depth = 0, ancestorCollapsed = false) {
    if (!entry || visited.has(entry.id)) return;
    visited.add(entry.id);

    const children = childrenByParentId.get(entry.id) || [];
    const childIds = children.map((c) => c.id);
    const collapsed = isLayerGroupCollapsed(entry.id);

    ordered.push({
      id: entry.id,
      layer: entry.layer,
      info: entry.info,
      parentLayerId: depth > 0 ? entry.parentLayerId : null,
      depth,
      childIds,
      hasChildren: childIds.length > 0,
      collapsed,
      hiddenByCollapsedAncestor: ancestorCollapsed,
    });

    children.forEach((child) => {
      visit(child, depth + 1, ancestorCollapsed || collapsed);
    });
  }

  roots.forEach((root) => visit(root, 0, false));
  entries.forEach((entry) => {
    if (!visited.has(entry.id)) visit(entry, 0, false);
  });

  return ordered;
}

function isLayerVisible(layerOrId) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return false;
  if (typeof layer.__isVisible === 'boolean') return layer.__isVisible;
  const { map, drawnItems } = getAppRefs();
  return !!(
    (map && typeof map.hasLayer === 'function' && map.hasLayer(layer)) ||
    (drawnItems && typeof drawnItems.hasLayer === 'function' && drawnItems.hasLayer(layer))
  );
}

function setLayerVisibility(layerOrId, visible) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return false;
  const { map, drawnItems } = getAppRefs();
  const nextVisible = Boolean(visible);
  // Set the marker before Leaflet emits layerremove, otherwise the cleanup
  // listener can mistake a visibility change for a real deletion.
  layer.__isVisible = nextVisible;

  try {
    if (nextVisible) {
      if (map && typeof map.addLayer === 'function' && !map.hasLayer?.(layer)) map.addLayer(layer);
      if (drawnItems && typeof drawnItems.addLayer === 'function' && !drawnItems.hasLayer?.(layer)) drawnItems.addLayer(layer);
    } else {
      if (drawnItems && typeof drawnItems.removeLayer === 'function' && drawnItems.hasLayer?.(layer)) drawnItems.removeLayer(layer);
      if (map && typeof map.removeLayer === 'function' && map.hasLayer?.(layer)) map.removeLayer(layer);
    }
  } catch (_) {
    layer.__isVisible = !nextVisible;
    return false;
  }

  return nextVisible;
}

function removeLayerTree(id) {
  const descendants = [];
  const queue = [...getChildLayerIds(id)];
  const seen = new Set(queue);

  while (queue.length) {
    const childId = queue.shift();
    descendants.push(childId);
    const nested = getChildLayerIds(childId);
    nested.forEach((nestedId) => {
      if (seen.has(nestedId)) return;
      seen.add(nestedId);
      queue.push(nestedId);
    });
  }

  descendants.slice().reverse().forEach((childId) => removeLayer(childId));
  const removedRoot = removeLayer(id);
  return {
    removed: removedRoot ? [id, ...descendants] : descendants,
    descendantIds: descendants,
    ok: removedRoot,
  };
}

function getLayerInfo(layerOrId) {
  const layer = typeof layerOrId === 'string' ? getLayer(layerOrId) : layerOrId;
  if (!layer) return null;

  const { map, drawnItems } = getAppRefs();
  const id = ensureStableId(layer, layer?.feature?.properties?.__id);
  const geojson = typeof layer.toGeoJSON === 'function' ? layer.toGeoJSON() : null;
  const geometryType = getGeometryType(layer);
  const geometryLabel = getGeometryLabel(geometryType);
  const properties = geojson?.properties || layer.feature?.properties || {};
  const metadata = sanitizeMetadata(getToolMetadata(layer));
  const history = getToolHistory(layer);
  const bounds = getLayerBounds(layer);
  const name = getLayerName(layer);
  const featureCount = getFeatureCountFromGeoJSON(geojson);

  let sourceKind = 'unknown';
  let sourceLabel = 'Layer';
  const importSummary = properties?.importSummary || null;

  if (importSummary) {
    sourceKind = 'imported';
    sourceLabel = 'Imported';
  } else if (metadata?.parentLayerId) {
    sourceKind = 'derived';
    sourceLabel = 'Derived';
  } else if (metadata?.name === 'Draw' || metadata?.name === 'Edit') {
    sourceKind = 'manual';
    sourceLabel = 'Manual';
  } else if (metadata?.provider || metadata?.name === 'Generate AI Features') {
    sourceKind = 'ai';
    sourceLabel = 'AI';
  } else if (metadata?.name) {
    sourceKind = 'tool';
    sourceLabel = metadata.name;
  }

  const displayName = name || (importSummary?.fileName
    ? importSummary.fileName.replace(/\.[^/.]+$/, '')
    : geometryLabel || id || 'Layer');

  const visible = !!(
    (map && typeof map.hasLayer === 'function' && map.hasLayer(layer)) ||
    (drawnItems && typeof drawnItems.hasLayer === 'function' && drawnItems.hasLayer(layer))
  );

  return {
    id,
    label: geometryType ? `${geometryType} (${id})` : id,
    name,
    displayName,
    properties,
    geojson,
    bounds,
    geometry: {
      type: geometryType,
      label: geometryLabel,
      featureCount,
      bounds,
    },
    source: {
      kind: sourceKind,
      label: sourceLabel,
      parentLayerId: metadata?.parentLayerId || null,
      input: metadata?.params?.Input || null,
      provider: metadata?.provider || null,
      importedFileName: importSummary?.fileName || null,
      importSummary,
      metadata,
    },
    provenance: {
      metadata,
      history,
    },
    ui: {
      visible,
      selectable: true,
      removable: true,
      editable: true,
      selected: isLayerSelected(id),
      active: getActiveLayerId() === id,
    },
    // Compatibility aliases for older code paths.
    geometryType,
    metadata,
    history,
  };
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

  // If this is a group layer, also unregister its child layers
  if (typeof layer.eachLayer === 'function') {
    try {
      layer.eachLayer((child) => {
        if (child && child.__id && child.__id !== id) {
          if (map && map.removeLayer) map.removeLayer(child);
          unregisterLayer(child.__id);
        }
      });
    } catch (_) {}
  }

  // Remove from TOC list if present, or from parent group layer if child
  try {
    const idx = tocLayers.indexOf(layer);
    if (idx >= 0) {
      tocLayers.splice(idx, 1);
    } else if (Array.isArray(tocLayers)) {
      const emptyParentIds = [];
      tocLayers.forEach((tocLayer) => {
        if (!tocLayer || tocLayer === layer) return;
        let belongedToParent = false;
        if (typeof tocLayer.hasLayer === 'function' && tocLayer.hasLayer(layer)) {
          belongedToParent = true;
          if (typeof tocLayer.removeLayer === 'function') tocLayer.removeLayer(layer);
        } else if (typeof tocLayer.eachLayer === 'function') {
          tocLayer.eachLayer((child) => {
            if (child === layer || (child?.__id && child.__id === id)) {
              belongedToParent = true;
            }
          });
          if (belongedToParent && typeof tocLayer.removeLayer === 'function') {
            tocLayer.removeLayer(layer);
          }
        }
        if (
          belongedToParent &&
          typeof tocLayer.getLayers === 'function' &&
          tocLayer.getLayers().length === 0 &&
          tocLayer.__id
        ) {
          emptyParentIds.push(tocLayer.__id);
        }
      });
      emptyParentIds.forEach((parentId) => removeLayer(parentId));
    }
  } catch (_) {}

  unregisterLayer(id);
  return true;
}

function clearAllLayers() {
  ensureLayerRemoveListener();
  const { drawnItems, tocLayers } = getAppRefs();
  const removedIds = [];

  const allTocIds = Array.isArray(tocLayers)
    ? tocLayers.map((layer) => layer?.__id || ensureStableId(layer)).filter(Boolean)
    : [];
  const allRegistryIds = Array.from(_registry.keys());
  const uniqueIds = Array.from(new Set([...allTocIds, ...allRegistryIds]));

  uniqueIds.forEach((id) => {
    if (removeLayer(id)) removedIds.push(id);
  });

  try {
    if (drawnItems && typeof drawnItems.clearLayers === 'function') {
      drawnItems.clearLayers();
    }
  } catch (_) {}

  return removedIds;
}

function handleDrawDeleted(deletedLayers) {
  ensureLayerRemoveListener();
  const { drawnItems } = getAppRefs();
  const removedIds = [];
  const candidates = [];

  if (deletedLayers && typeof deletedLayers.eachLayer === 'function') {
    deletedLayers.eachLayer((layer) => candidates.push(layer));
  } else if (Array.isArray(deletedLayers)) {
    candidates.push(...deletedLayers);
  }

  candidates.forEach((layer) => {
    if (layer && layer.__id) {
      if (removeLayer(layer.__id)) removedIds.push(layer.__id);
    } else {
      try {
        if (drawnItems && typeof drawnItems.removeLayer === 'function') {
          drawnItems.removeLayer(layer);
        }
      } catch (_) {}
    }
  });

  if (
    candidates.length > 0 &&
    drawnItems &&
    typeof drawnItems.getLayers === 'function' &&
    drawnItems.getLayers().length === 0
  ) {
    const remainingRemoved = clearAllLayers();
    remainingRemoved.forEach((id) => {
      if (!removedIds.includes(id)) removedIds.push(id);
    });
  }

  return removedIds;
}

function listLayers() {
  ensureLayerRemoveListener();
  const { tocLayers } = getAppRefs();
  // Prefer TOC list (it reflects "layers we care about").
  const layers = Array.isArray(tocLayers) ? tocLayers : [];
  return layers.map((layer) => {
    // Ensure the layer is both ID'd and registered.
    const preferredId = layer?.feature?.properties?.__id;
    const preferredDatasetId = layer?.feature?.properties?.__datasetId;
    const id = registerLayer(layer, preferredId, preferredDatasetId);
    const geomType = getGeometryType(layer);
    const info = getLayerInfo(layer);
    return {
      id,
      datasetId: ensureDatasetId(layer),
      geometryType: geomType,
      // Best-effort label. Tools can choose to display id or a friendlier string.
      label: info?.displayName || (geomType ? `${geomType} (${id})` : id),
      displayName: info?.displayName || '',
      featureCount: info?.geometry?.featureCount || 0,
      source: info?.source || null,
      ui: info?.ui || null,
    };
  });
}

function listLayerGroups() {
  ensureLayerRemoveListener();
  const { tocLayers } = getAppRefs();
  const layers = Array.isArray(tocLayers) ? tocLayers : [];
  const groups = new Map();

  for (const layer of layers) {
    const datasetId = ensureDatasetId(layer);
    const info = getLayerInfo(layer);
    const geometryType = info?.geometryType || 'Feature';

    if (!groups.has(datasetId)) {
      groups.set(datasetId, {
        id: datasetId,
        geometryType,
        featureCount: 0,
        label: info?.displayName || geometryType,
      });
    }

    const group = groups.get(datasetId);
    group.featureCount += 1;
    if (!group.label && info?.displayName) group.label = info.displayName;
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    label: group.featureCount === 1
      ? `${group.label || group.geometryType} (${group.id})`
      : `${group.label || group.geometryType} (${group.featureCount} features)`,
  }));
}

function getState() {
  ensureLayerRemoveListener();
  const layers = listLayers();
  const { map } = getAppRefs();
  return {
    layerCount: layers.length,
    layers,
    bounds: map && map.getBounds ? map.getBounds() : null,
    selection: {
      activeLayerId: getActiveLayerId(),
      selectedLayerIds: getSelectedLayerIds(),
      selectedFeaturesByLayerId: getSelectedFeaturesByLayerId(),
    },
  };
}

// ToolResult is intentionally minimal for now.
function isGeoJSONFeature(value) {
  return !!value && value.type === 'Feature' && value.geometry && typeof value.geometry.type === 'string';
}

function isAggregateFeatureGeometry(geometryType) {
  return geometryType === 'MultiPoint'
    || geometryType === 'MultiLineString'
    || geometryType === 'MultiPolygon'
    || geometryType === 'GeometryCollection';
}

function shouldAddAsSingleResultLayer(gj) {
  if (!gj || typeof gj !== 'object') return false;
  if (gj.type === 'FeatureCollection' || gj.type === 'GeometryCollection') return true;
  if (isGeoJSONFeature(gj) && isAggregateFeatureGeometry(gj.geometry?.type)) return true;
  return false;
}

function coalesceAdditions(addGeojson) {
  if (!addGeojson) return [];
  if (!Array.isArray(addGeojson)) return [addGeojson];
  if (addGeojson.length === 0) return [];

  const everyItemIsFeature = addGeojson.every(isGeoJSONFeature);
  if (everyItemIsFeature) {
    const sharedMetadata = addGeojson.find(item => item && item.toolMetadata)?.toolMetadata || null;
    const collection = {
      type: 'FeatureCollection',
      features: addGeojson,
    };
    if (sharedMetadata) collection.toolMetadata = sharedMetadata;
    return [collection];
  }

  return addGeojson;
}

function hasFeatureSymbology(gj) {
  if (!gj || typeof gj !== 'object') return false;
  if (gj.toolMetadata?.comparison || gj.toolMetadata?.result?.groups) return true;
  if (gj.type === 'Feature') return Boolean(getFeatureSymbologyStyle(gj));
  if (gj.type === 'FeatureCollection' && Array.isArray(gj.features)) {
    return gj.features.some((feature) => Boolean(getFeatureSymbologyStyle(feature)));
  }
  return false;
}

function buildGeoJsonSymbologyOptions(gj) {
  if (!hasFeatureSymbology(gj)) return undefined;
  return {
    style: (feature) => getFeatureSymbologyStyle(feature) || undefined,
    pointToLayer: (feature, latlng) => {
      const symStyle = getFeatureSymbologyStyle(feature);
      if (symStyle && typeof L !== 'undefined' && typeof L.circleMarker === 'function') {
        return L.circleMarker(latlng, symStyle);
      }
      if (typeof L !== 'undefined' && typeof L.marker === 'function') {
        return L.marker(latlng);
      }
      return null;
    },
  };
}

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
  const toAdd = coalesceAdditions(toolResult.addGeojson);
  if (!toAdd.length) return { ok: true, added, removed, errors };

  for (const gj of toAdd) {
    try {
      const parentLayer = gj?.toolMetadata?.parentLayerId ? getLayer(gj.toolMetadata.parentLayerId) : null;
      const isCollection = shouldAddAsSingleResultLayer(gj);
      const geojsonOptions = buildGeoJsonSymbologyOptions(gj);
      let primaryAddedLayerId = null;

      if (isCollection) {
        // Add the entire result dataset as a single group layer (one layer in TOC).
        const groupLayer = geojsonOptions ? L.geoJSON(gj, geojsonOptions) : L.geoJSON(gj);
        const datasetId = ensureDatasetId(groupLayer, gj?.properties?.__datasetId || _uuid());

        const preferredGroupId = gj?.properties?.__id || undefined;
        const id = registerLayer(groupLayer, preferredGroupId, datasetId);
        ensureStableId(groupLayer, id);
        ensureFeatureIdentifiers(gj, id);
        if (typeof groupLayer.eachLayer === 'function') {
          groupLayer.eachLayer((child, index) => {
            const preferredId = child?.feature?.properties?.__id || `${id}-${index + 1}`;
            registerLayer(child, preferredId, datasetId);
            ensureStableId(child, preferredId);
            ensureDatasetId(child, datasetId);
            const symStyle = getFeatureSymbologyStyle(child?.feature);
            if (symStyle) {
              child.__symbologyStyle = symStyle;
              if (typeof child.setStyle === 'function') child.setStyle(symStyle);
            }
          });
        }

        // Attach feature object on group layer for metadata/history
        if (!groupLayer.feature) {
          groupLayer.feature = { type: 'Feature', properties: {} };
        }
        if (!groupLayer.feature.properties) groupLayer.feature.properties = {};
        groupLayer.feature.properties.__id = id;
        groupLayer.feature.properties.__datasetId = datasetId;

        // Apply tool metadata / history
        try {
          const md = gj.toolMetadata || null;
          ensureToolHistory(groupLayer, md, { inheritFromLayer: parentLayer });
        } catch (e) {
          if (DEBUG) console.warn('applyResult: toolMetadata attach failed', e);
        }

        // Add to map + editable group
        try { groupLayer.addTo(map); } catch (e) { if (DEBUG) console.warn('applyResult: map add failed', e); }
        try { drawnItems.addLayer(groupLayer); } catch (e) { if (DEBUG) console.warn('applyResult: drawnItems add failed', e); }

        // Restore persisted declarative symbology if present and valid
        if (gj && gj.symbology) {
          try {
            setLayerSymbology(groupLayer, gj.symbology);
          } catch (e) {
            if (DEBUG) console.warn('applyResult: ignoring invalid symbology on import', e);
          }
        }

        // Track in TOC as a single entry
        if (Array.isArray(tocLayers) && !tocLayers.includes(groupLayer)) tocLayers.push(groupLayer);

        added.push(groupLayer.__id);
        primaryAddedLayerId = groupLayer.__id;
      } else {
        // Single Feature (or empty collection) – add individually as before.
        ensureFeatureIdentifiers(gj);
        const layer = L.geoJSON(gj);
        const datasetId = gj?.properties?.__datasetId || _uuid();
        layer.eachLayer((child) => {
          const preferredId = child?.feature?.properties?.__id;
          const childDatasetId = child?.feature?.properties?.__datasetId || datasetId;
          const id = registerLayer(child, preferredId, childDatasetId);
          ensureStableId(child, preferredId || id);
          ensureDatasetId(child, childDatasetId);

          try {
            const md = (gj && gj.toolMetadata) || (child.feature && child.feature.toolMetadata) || (child.feature && child.feature.properties && child.feature.properties.toolMetadata);
            ensureToolHistory(child, md, { inheritFromLayer: parentLayer });
          } catch (e) {
            if (DEBUG) console.warn('applyResult: toolMetadata attach failed', e);
          }

          try { child.addTo(map); } catch (e) { if (DEBUG) console.warn('applyResult: map add failed', e); }
          try { drawnItems.addLayer(child); } catch (e) { if (DEBUG) console.warn('applyResult: drawnItems add failed', e); }

          const incomingSymbology = (gj && gj.symbology) || child?.feature?.symbology || null;
          if (incomingSymbology) {
            try {
              setLayerSymbology(child, incomingSymbology);
            } catch (e) {
              if (DEBUG) console.warn('applyResult: ignoring invalid symbology on import', e);
            }
          }

          if (Array.isArray(tocLayers) && !tocLayers.includes(child)) tocLayers.push(child);

          added.push(child.__id);
          if (!primaryAddedLayerId) primaryAddedLayerId = child.__id;
        });
      }

      if (primaryAddedLayerId) focusLayerSelection(primaryAddedLayerId);
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
      if (DEBUG) console.warn('applyResult: addGeojson failed', e);
    }
  }

  return { ok: errors.length === 0, added, removed, errors };
}

function captureWorkspaceSnapshot() {
  const { tocLayers } = getAppRefs();
  const layers = (Array.isArray(tocLayers) ? tocLayers : [])
    .map((layer) => {
      if (!layer) return null;
      const id = ensureStableId(layer);
      const datasetId = ensureDatasetId(layer);
      const geojson = typeof layer.toGeoJSON === 'function' ? JSON.parse(JSON.stringify(layer.toGeoJSON())) : null;
      if (!geojson) return null;
      const name = getLayerName(layer);
      const visible = isLayerVisible(layer);
      const toolMetadata = getToolMetadata(layer);
      const toolHistory = getToolHistory(layer);
      const symbology = getLayerSymbology(layer);
      return {
        id,
        datasetId,
        name,
        visible,
        geojson,
        ...(toolMetadata ? { toolMetadata: cloneMetadata(toolMetadata) } : {}),
        ...(toolHistory.length ? { toolHistory } : {}),
        ...(symbology ? { symbology } : {}),
      };
    })
    .filter(Boolean);

  return {
    layers,
    selection: {
      activeLayerId: getActiveLayerId(),
      selectedLayerIds: getSelectedLayerIds(),
      selectedFeaturesByLayerId: getSelectedFeaturesByLayerId(),
    },
  };
}

function restoreWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, restoredCount: 0 };
  }

  clearAllLayers();
  const entries = Array.isArray(snapshot.layers) ? snapshot.layers : [];
  let restoredCount = 0;

  entries.forEach((entry) => {
    if (!entry || !entry.geojson) return;
    const gj = JSON.parse(JSON.stringify(entry.geojson));
    if (!gj.properties || typeof gj.properties !== 'object') gj.properties = {};
    if (entry.id) gj.properties.__id = entry.id;
    if (entry.datasetId) gj.properties.__datasetId = entry.datasetId;
    if (entry.toolMetadata) gj.toolMetadata = cloneMetadata(entry.toolMetadata);
    if (entry.symbology) gj.symbology = JSON.parse(JSON.stringify(entry.symbology));

    const res = applyResult({ addGeojson: gj });
    if (res && res.ok && res.added.length) {
      restoredCount += 1;
      const restoredLayer = getLayer(entry.id) || getLayer(res.added[0]);
      if (restoredLayer) {
        if (entry.name) setLayerName(restoredLayer, entry.name);
        if (Array.isArray(entry.toolHistory) && entry.toolHistory.length) {
          const feature = ensureLayerFeature(restoredLayer);
          feature.toolHistory = entry.toolHistory.map((item) => cloneMetadata(item)).filter(Boolean);
          feature.properties.toolHistory = feature.toolHistory;
        }
        if (entry.visible === false) {
          setLayerVisibility(restoredLayer, false);
        }
      }
    }
  });

  const sel = snapshot.selection || {};
  clearLayerSelection();
  if (Array.isArray(sel.selectedLayerIds) && sel.selectedLayerIds.length) {
    setSelectedLayerIds(sel.selectedLayerIds);
  }
  if (sel.activeLayerId) {
    setActiveLayerId(sel.activeLayerId);
  }
  if (sel.selectedFeaturesByLayerId && typeof sel.selectedFeaturesByLayerId === 'object') {
    Object.entries(sel.selectedFeaturesByLayerId).forEach(([layerId, featureIds]) => {
      if (Array.isArray(featureIds) && featureIds.length) {
        setSelectedFeatureIds(layerId, featureIds);
      }
    });
  }

  return { ok: true, restoredCount };
}

module.exports = {
  ensureStableId,
  ensureDatasetId,
  ensureToolHistory,
  registerLayer,
  getLayer,
  getLayerSymbology,
  setLayerSymbology,
  resetLayerSymbology,
  getLayerSymbologyDomain,
  getLayersByDatasetId,
  getLayerInfo,
  getLayerBounds,
  getToolHistory,
  getLayerWorkflowExpression,
  getActiveLayerId,
  setActiveLayerId,
  getSelectedLayerIds,
  setSelectedLayerIds,
  isLayerSelected,
  selectLayer,
  deselectLayer,
  toggleLayerSelection,
  clearLayerSelection,
  getSelectedFeaturesByLayerId,
  getSelectedFeatureIds,
  setSelectedFeatureIds,
  clearSelectedFeatureIds,
  focusLayerSelection,
  getLayerName,
  setLayerName,
  getChildLayerIds,
  getTocLayerHierarchy,
  isLayerGroupCollapsed,
  setLayerGroupCollapsed,
  toggleLayerGroupCollapsed,
  isLayerVisible,
  setLayerVisibility,
  removeLayerTree,
  getMap,
  listLayers,
  listLayerGroups,
  getState,
  applyResult,
  captureWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  removeLayer,
  clearAllLayers,
  handleDrawDeleted,
};
