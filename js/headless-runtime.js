const { BufferTool } = require('./tools/BufferTool');
const { ExportTool } = require('./tools/ExportTool');
const { RandomPointsTool } = require('./tools/RandomPointsTool');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createBoundsFromBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [west, south, east, north] = bbox.map(Number);
  if ([west, south, east, north].some((n) => Number.isNaN(n))) return null;

  return {
    bbox: [west, south, east, north],
    getSouthWest() {
      return { lng: west, lat: south };
    },
    getNorthEast() {
      return { lng: east, lat: north };
    },
  };
}

function createLayerRecord(rawLayer, fallbackIndex = 0) {
  const id = rawLayer?.id || `layer-${fallbackIndex + 1}`;
  const geojson = deepClone(rawLayer?.geojson ?? rawLayer?.data ?? rawLayer);
  if (!geojson || typeof geojson !== 'object') {
    throw new Error(`Layer ${id} is missing GeoJSON data`);
  }

  const geometryType = geojson?.geometry?.type
    || (geojson?.type === 'FeatureCollection' ? (geojson.features?.[0]?.geometry?.type || 'FeatureCollection') : geojson?.type)
    || 'Layer';

  const layer = {
    __id: id,
    feature: {
      type: 'Feature',
      properties: {
        __id: id,
        ...(rawLayer?.name ? { name: rawLayer.name, layerName: rawLayer.name, displayName: rawLayer.name } : {}),
      },
    },
    toGeoJSON() {
      return deepClone(geojson);
    },
  };

  if ((geometryType === 'Polygon' || geometryType === 'MultiPolygon') && globalThis.L?.Polygon?.prototype) {
    Object.setPrototypeOf(layer, globalThis.L.Polygon.prototype);
  }

  return {
    id,
    name: rawLayer?.name || id,
    geometryType,
    geojson,
    layer,
  };
}

function createHeadlessRuntime(input = {}) {
  const initialLayers = Array.isArray(input.layers) ? input.layers : [];
  const layerRecords = initialLayers.map((layer, index) => createLayerRecord(layer, index));
  const registry = new Map(layerRecords.map((record) => [record.id, record]));
  const added = [];
  const removed = [];
  const bounds = createBoundsFromBbox(input.bbox || input.bounds || null);

  function getLayer(id) {
    return registry.get(id)?.layer || null;
  }

  function listLayers() {
    return Array.from(registry.values()).map((record) => ({
      id: record.id,
      label: record.name,
      displayName: record.name,
      geometryType: record.geometryType,
      featureCount: record.geojson?.type === 'FeatureCollection' ? (record.geojson.features || []).length : 1,
      source: { kind: 'headless-input', label: 'Headless Input' },
      ui: { visible: true, selectable: true, removable: true, editable: false },
    }));
  }

  function applyResult(toolResult) {
    const result = { ok: true, added: [], removed: [], errors: [] };
    if (!toolResult || typeof toolResult !== 'object') return result;

    const toRemove = Array.isArray(toolResult.removeLayerIds) ? toolResult.removeLayerIds : [];
    toRemove.forEach((id) => {
      if (registry.delete(id)) {
        removed.push(id);
        result.removed.push(id);
      }
    });

    const additions = Array.isArray(toolResult.addGeojson)
      ? toolResult.addGeojson
      : (toolResult.addGeojson ? [toolResult.addGeojson] : []);

    additions.forEach((geojson, index) => {
      const nextId = geojson?.feature?.properties?.__id
        || geojson?.properties?.__id
        || geojson?.toolMetadata?.layerId
        || `result-${added.length + index + 1}`;
      const name = geojson?.properties?.name || geojson?.toolMetadata?.name || nextId;
      const record = createLayerRecord({ id: nextId, name, geojson }, added.length + index);
      registry.set(record.id, record);
      added.push({ id: record.id, name: record.name, geojson: deepClone(geojson) });
      result.added.push(record.id);
    });

    return result;
  }

  return {
    bounds,
    getLayer,
    listLayers,
    applyResult,
    getState() {
      return {
        layerCount: registry.size,
        layers: listLayers(),
        bounds,
      };
    },
    getResponseState() {
      return {
        layers: Array.from(registry.values()).map((record) => ({
          id: record.id,
          name: record.name,
          geometryType: record.geometryType,
          geojson: deepClone(record.geojson),
        })),
        added: deepClone(added),
        removed: [...removed],
        bbox: bounds?.bbox || null,
      };
    },
  };
}

const HEADLESS_TOOLS = {
  BufferTool,
  ExportTool,
  RandomPointsTool,
};

function getHeadlessToolCatalog() {
  return Object.entries(HEADLESS_TOOLS).map(([key, ToolClass]) => {
    const instance = new ToolClass();
    const spec = instance.getSpec();
    return {
      key,
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      headless: true,
    };
  });
}

async function runHeadlessTool({ tool: toolKey, params = {}, state = {} }) {
  const ToolClass = HEADLESS_TOOLS[toolKey];
  if (!ToolClass) {
    const supported = Object.keys(HEADLESS_TOOLS);
    const error = new Error(`Unsupported headless tool: ${toolKey}`);
    error.statusCode = 400;
    error.details = { supportedTools: supported };
    throw error;
  }

  const runtime = createHeadlessRuntime(state);
  const tool = new ToolClass();
  const context = {
    map: state.map || null,
    state: runtime.getState(),
    tool,
    getLayer: runtime.getLayer,
    listLayers: runtime.listLayers,
    applyResult: runtime.applyResult,
  };

  const output = await tool.run(params, context);

  return {
    ok: tool.getStatus().code === 0,
    tool: toolKey,
    status: tool.getStatus(),
    output: output || null,
    state: runtime.getResponseState(),
  };
}

module.exports = {
  HEADLESS_TOOLS,
  createHeadlessRuntime,
  getHeadlessToolCatalog,
  runHeadlessTool,
};
