const { BufferTool } = require('./tools/BufferTool');
const { ExportTool } = require('./tools/ExportTool');
const { GroupTool } = require('./tools/GroupTool');
const { RandomPointsTool } = require('./tools/RandomPointsTool');
const { AddAIGeneratedFieldTool } = require('./tools/AddAIGeneratedFieldTool');
const { ConvertTextToNumericTool } = require('./tools/ConvertTextToNumericTool');

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

function createUniqueLayerId(registry, preferredId) {
  if (preferredId && !registry.has(preferredId)) {
    return preferredId;
  }

  if (preferredId) {
    let suffix = 2;
    let candidate = `${preferredId}-${suffix}`;
    while (registry.has(candidate)) {
      suffix += 1;
      candidate = `${preferredId}-${suffix}`;
    }
    return candidate;
  }

  let index = 1;
  let candidate = `result-${index}`;
  while (registry.has(candidate)) {
    index += 1;
    candidate = `result-${index}`;
  }
  return candidate;
}

function createHeadlessRuntime(input = {}) {
  const initialLayers = Array.isArray(input.layers) ? input.layers : [];
  const layerRecords = initialLayers.map((layer, index) => createLayerRecord(layer, index));
  const registry = new Map(layerRecords.map((record) => [record.id, record]));
  const added = [];
  const removed = [];
  const bounds = createBoundsFromBbox(input.bbox || input.bounds || null);
  const inputSelection = input.selection || {};
  const selection = {
    activeLayerId: typeof inputSelection.activeLayerId === 'string' ? inputSelection.activeLayerId : null,
    selectedLayerIds: Array.isArray(inputSelection.selectedLayerIds) ? [...new Set(inputSelection.selectedLayerIds.filter((id) => registry.has(id)))] : [],
    selectedFeaturesByLayerId: Object.entries(inputSelection.selectedFeaturesByLayerId || {}).reduce((acc, [layerId, featureIds]) => {
      if (!registry.has(layerId) || !Array.isArray(featureIds)) return acc;
      acc[layerId] = [...new Set(featureIds.filter(Boolean))];
      return acc;
    }, {}),
  };

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
      const preferredId = geojson?.feature?.properties?.__id
        || geojson?.properties?.__id
        || geojson?.toolMetadata?.layerId
        || null;
      const nextId = createUniqueLayerId(registry, preferredId);
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
        selection: deepClone(selection),
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
        selection: deepClone(selection),
      };
    },
  };
}

const HEADLESS_TOOLS = {
  BufferTool,
  ExportTool,
  GroupTool,
  RandomPointsTool,
};

const FEATURE_COLLECTION_TOOLS = {
  AddAIGeneratedFieldTool,
  ConvertTextToNumericTool,
};

function getHeadlessToolCatalog() {
  const layerStateTools = Object.entries(HEADLESS_TOOLS).map(([key, ToolClass]) => {
    const instance = new ToolClass();
    const spec = instance.getSpec();
    return {
      key,
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      headless: true,
      stateMode: 'layers',
    };
  });

  const featureCollectionTools = Object.entries(FEATURE_COLLECTION_TOOLS)
    .map(([_key, ToolClass]) => {
      const tool = new ToolClass();
      const spec = tool.getSpec();
      return {
        key: spec.key,
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        headless: true,
        stateMode: 'featureCollection',
      };
    });

  return [...layerStateTools, ...featureCollectionTools];
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

  const validation = await tool.validate(params, context);
  if (!validation.ok) {
    const message = validation.errors[0] || 'Invalid tool parameters.';
    tool.setStatus(2, message);
    return {
      ok: false,
      tool: toolKey,
      status: tool.getStatus(),
      validation,
      output: null,
      state: runtime.getResponseState(),
    };
  }

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
