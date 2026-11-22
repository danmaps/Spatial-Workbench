const { createComponentSession } = require('./session');
const { renderComposition } = require('./renderers');
const { generateOpenUISystemPrompt, parseOpenUILang } = require('./adapters/openui');

const PROTOTYPE_STUDY_SITES_FIXTURE = Object.freeze({
  id: 'study-sites',
  name: 'Study Sites',
  displayName: 'Study Sites',
  geometryType: 'Point',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'study-sites-1',
        properties: {
          __id: 'study-sites-1',
          name: 'Site Alpha',
          zone: 'Civic Center',
          area_sqm: 14500,
        },
        geometry: {
          type: 'Point',
          coordinates: [-118.2437, 34.0522],
        },
      },
      {
        type: 'Feature',
        id: 'study-sites-2',
        properties: {
          __id: 'study-sites-2',
          name: 'Site Beta',
          zone: 'Arts District',
          area_sqm: 18200,
        },
        geometry: {
          type: 'Point',
          coordinates: [-118.2351, 34.0407],
        },
      },
      {
        type: 'Feature',
        id: 'study-sites-3',
        properties: {
          __id: 'study-sites-3',
          name: 'Site Gamma',
          zone: 'Harbor Gateway',
          area_sqm: 9800,
        },
        geometry: {
          type: 'Point',
          coordinates: [-118.2812, 33.9894],
        },
      },
    ],
  },
});

const PROTOTYPE_OPENUI_EXPRESSIONS = Object.freeze({
  compact: `CompactCard([
  LayerInput({ componentId: "proto-layer-input", toolKey: "BufferTool", parameterName: "Input Layer", selectedLayerId: "study-sites", targetScope: "selection" }),
  SpatialSelection({ componentId: "proto-selection", layerId: "study-sites", mode: "selected_features", emptySelectionPolicy: "block" }),
  ToolParameters({ componentId: "proto-buffer-params", toolKey: "BufferTool", lockedParams: ["Input Layer"], draftParams: { "Input Layer": "study-sites", Distance: 500, Units: "meters" } }),
  SpatialResult({ componentId: "proto-spatial-result", surfaceVariant: "compact" }),
  ExecutionReceipt({ componentId: "proto-receipt", toolKey: "BufferTool" })
])`,
  workspace: `ReviewWorkspace([
  LayerInput({ componentId: "proto-layer-input", toolKey: "BufferTool", parameterName: "Input Layer", selectedLayerId: "study-sites", targetScope: "selection" }),
  SpatialSelection({ componentId: "proto-selection", layerId: "study-sites", mode: "selected_features", emptySelectionPolicy: "block" }),
  ToolParameters({ componentId: "proto-buffer-params", toolKey: "BufferTool", lockedParams: ["Input Layer"], draftParams: { "Input Layer": "study-sites", Distance: 500, Units: "meters" } }),
  ExecutionReceipt({ componentId: "proto-receipt", toolKey: "BufferTool" }),
  SpatialResult({ componentId: "proto-spatial-result", surfaceVariant: "workspace" })
])`,
  streamingPartial: `CompactCard([
  LayerInput({ componentId: "proto-layer-input", toolKey: "BufferTool", parameterName: "Input Layer", selectedLayerId: "study-sites", targetScope: "selection" }),
  ToolParameters({ componentId: "proto-buffer-params", toolKey: "BufferTool", draftParams: { "Input Layer": "study-sites", Distance: 500, Units: "meters" } }),
  SpatialResult({ componentId: "proto-spatial-result"`,
});

function createPrototypeController(options = {}) {
  const container = options.container || null;
  const runner = options.runner || null;
  const onDownload = options.onDownload || null;

  let activeLayout = options.initialLayout === 'workspace' ? 'workspace' : 'compact';
  let activeExpression = PROTOTYPE_OPENUI_EXPRESSIONS[activeLayout];

  const session = createComponentSession({
    layers: [PROTOTYPE_STUDY_SITES_FIXTURE],
    selection: {
      activeLayerId: 'study-sites',
      selectedLayerIds: ['study-sites'],
      selectedFeaturesByLayerId: {
        'study-sites': ['study-sites-1', 'study-sites-2'],
      },
      targetScope: 'selection',
    },
    drafts: {
      BufferTool: {
        'Input Layer': 'study-sites',
        Distance: 500,
        Units: 'meters',
        targetScope: 'selection',
      },
    },
  });

  let lastResolved = null;

  function render() {
    const parsed = parseOpenUILang(activeExpression, {
      layout: activeLayout,
    });
    session.setStreamComplete(parsed.streamComplete);
    lastResolved = session.resolveLayout(parsed);

    if (container) {
      renderComposition(container, lastResolved, {
        enableLeafletMap: options.enableLeafletMap !== false,
        leaflet: options.leaflet || null,
        onEvent: (event) => {
          if (event.eventType === 'swb:execute-requested') {
            runBuffer(event.payload?.params || null);
            return;
          }
          if (event.eventType === 'swb:artifact-download') {
            if (typeof onDownload === 'function') onDownload(event.payload);
            return;
          }
          session.dispatchEvent(event);
          render();
        },
      });
    }

    return lastResolved;
  }

  function setLayout(nextLayout) {
    activeLayout = nextLayout === 'workspace' ? 'workspace' : 'compact';
    activeExpression = PROTOTYPE_OPENUI_EXPRESSIONS[activeLayout];
    return render();
  }

  function setOpenUIExpression(expressionText, layoutOverride = null) {
    if (layoutOverride) {
      activeLayout = layoutOverride === 'workspace' ? 'workspace' : 'compact';
    }
    activeExpression = String(expressionText || '');
    return render();
  }

  async function runBuffer(overrideParams = null) {
    const result = await session.executeTool({
      toolKey: 'BufferTool',
      params: overrideParams,
      runner,
    });
    render();
    return result;
  }

  async function runExport(targetLayerId = null) {
    const state = session.getState();
    const latestAdded = state.added[state.added.length - 1]?.id;
    const fallbackOutput = state.layers.find((l) => l.id !== 'study-sites')?.id || 'study-sites';
    const layerToExport = targetLayerId || latestAdded || fallbackOutput;

    const result = await session.executeTool({
      toolKey: 'ExportTool',
      params: {
        Layer: layerToExport,
        Format: 'GeoJSON',
        targetScope: 'layer',
      },
      replacePreviousOutput: false,
      runner,
    });
    render();
    return result;
  }

  if (container) {
    render();
  }

  return {
    session,
    render,
    setLayout,
    setOpenUIExpression,
    runBuffer,
    runExport,
    getSystemPrompt: () => generateOpenUISystemPrompt(),
    getLastResolved: () => lastResolved,
  };
}

module.exports = {
  PROTOTYPE_STUDY_SITES_FIXTURE,
  PROTOTYPE_OPENUI_EXPRESSIONS,
  createPrototypeController,
};
