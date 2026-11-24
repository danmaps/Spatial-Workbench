const mockMap = {
  on: jest.fn(),
  removeLayer: jest.fn(),
  hasLayer: jest.fn(() => false),
  getBounds: jest.fn(() => null),
};

const mockDrawnItems = {
  hasLayer: jest.fn(() => false),
  removeLayer: jest.fn(),
  addLayer: jest.fn(),
};

const tocLayers = [];

jest.mock('./app', () => ({
  map: mockMap,
  drawnItems: mockDrawnItems,
  tocLayers,
}));

describe('state provenance helpers', () => {
  let state;

  function makeLayer(id, geometryType = 'Point') {
    return {
      __id: id,
      feature: { properties: { __id: id } },
      toGeoJSON: jest.fn(() => ({
        type: 'Feature',
        geometry: { type: geometryType, coordinates: geometryType === 'Point' ? [0, 0] : [] },
        properties: { __id: id },
      })),
    };
  }

  beforeEach(() => {
    jest.resetModules();
    global.L = {
      geoJSON: jest.fn((gj) => {
        const features = gj.type === 'FeatureCollection' ? gj.features : [gj];
        const children = features.map((feature, index) => ({
          feature,
          __id: feature.properties?.__id || `child-${index}`,
          addTo: jest.fn(),
          toGeoJSON: jest.fn(() => feature),
        }));
        return {
          eachLayer(cb) { children.forEach(cb); },
          addTo: jest.fn(),
          feature: null,
          toGeoJSON: jest.fn(() => gj),
          __id: undefined,
        };
      }),
      latLngBounds: jest.fn(() => ({ isValid: () => true })),
    };
    tocLayers.length = 0;
    state = require('./state');
  });

  test('selection state exposes active layer, selected layers, and selected features by layer', () => {
    const layerA = makeLayer('layer-a');
    const layerB = makeLayer('layer-b');

    state.registerLayer(layerA, 'layer-a');
    state.registerLayer(layerB, 'layer-b');
    tocLayers.push(layerA, layerB);

    expect(state.setSelectedLayerIds(['layer-a', 'layer-b', 'missing', 'layer-a'])).toEqual(['layer-a', 'layer-b']);
    expect(state.getSelectedLayerIds()).toEqual(['layer-a', 'layer-b']);
    expect(state.getActiveLayerId()).toBe('layer-a');

    expect(state.setActiveLayerId('layer-b')).toBe('layer-b');
    expect(state.getActiveLayerId()).toBe('layer-b');

    expect(state.setSelectedFeatureIds('layer-a', ['feature-1', 'feature-2', 'feature-1'])).toEqual(['feature-1', 'feature-2']);
    expect(state.setSelectedFeatureIds('layer-b', ['feature-9'])).toEqual(['feature-9']);
    expect(state.getSelectedFeaturesByLayerId()).toEqual({
      'layer-a': ['feature-1', 'feature-2'],
      'layer-b': ['feature-9'],
    });

    expect(state.getState().selection).toEqual({
      activeLayerId: 'layer-b',
      selectedLayerIds: ['layer-a', 'layer-b'],
      selectedFeaturesByLayerId: {
        'layer-a': ['feature-1', 'feature-2'],
        'layer-b': ['feature-9'],
      },
    });
  });

  test('selection helpers update and clean up per-layer selection state', () => {
    const layerA = makeLayer('layer-a');
    const layerB = makeLayer('layer-b');

    state.registerLayer(layerA, 'layer-a');
    state.registerLayer(layerB, 'layer-b');

    expect(state.selectLayer('layer-a', { makeActive: true })).toEqual(['layer-a']);
    expect(state.selectLayer('layer-b')).toEqual(['layer-a', 'layer-b']);
    expect(state.isLayerSelected('layer-a')).toBe(true);
    expect(state.getActiveLayerId()).toBe('layer-a');

    expect(state.toggleLayerSelection('layer-a')).toEqual(['layer-b']);
    expect(state.getActiveLayerId()).toBe('layer-b');

    state.setSelectedFeatureIds('layer-b', ['feature-9']);
    state.clearSelectedFeatureIds('layer-b');
    expect(state.getSelectedFeatureIds('layer-b')).toEqual([]);

    state.removeLayer('layer-b');
    expect(state.getSelectedLayerIds()).toEqual([]);
    expect(state.getActiveLayerId()).toBe(null);

    state.selectLayer('layer-a', { makeActive: true });
    state.setSelectedFeatureIds('layer-a', ['feature-1']);
    expect(state.clearLayerSelection()).toEqual([]);
    expect(state.getSelectedLayerIds()).toEqual([]);
    expect(state.getActiveLayerId()).toBe(null);
    expect(state.getSelectedFeatureIds('layer-a')).toEqual(['feature-1']);

    expect(state.clearSelectedFeatureIds()).toEqual({});
    expect(state.getSelectedFeaturesByLayerId()).toEqual({});
  });

  test('layer visibility can be toggled without unregistering the layer', () => {
    const layer = makeLayer('visible-layer');
    state.registerLayer(layer, 'visible-layer');

    expect(state.setLayerVisibility(layer, false)).toBe(false);
    expect(state.isLayerVisible(layer)).toBe(false);
    expect(state.getLayer('visible-layer')).toBe(layer);

    expect(state.setLayerVisibility(layer, true)).toBe(true);
    expect(state.isLayerVisible(layer)).toBe(true);
    expect(state.getLayer('visible-layer')).toBe(layer);
  });

  test('getLayerInfo exposes layer selection flags in ui metadata', () => {
    const layer = makeLayer('layer-selected');
    state.registerLayer(layer, 'layer-selected');
    tocLayers.push(layer);

    state.selectLayer('layer-selected', { makeActive: true });

    expect(state.getLayerInfo('layer-selected').ui).toEqual(expect.objectContaining({
      selected: true,
      active: true,
      selectable: true,
    }));
  });

  test('ensureToolHistory stores current metadata on a layer', () => {
    const layer = { feature: { properties: {} } };
    const history = state.ensureToolHistory(layer, { name: 'Draw', timestamp: '2026-04-30T00:00:00Z' });

    expect(history).toEqual([{ name: 'Draw', timestamp: '2026-04-30T00:00:00Z' }]);
    expect(layer.feature.properties.toolHistory).toHaveLength(1);
  });

  test('applyResult inherits parent history, activates the result layer, and clears prior feature selection', () => {
    const parentLayer = {
      __id: 'parent-1',
      feature: {
        properties: {
          __id: 'parent-1',
          toolHistory: [{ name: 'Draw', timestamp: '2026-04-30T00:00:00Z' }],
        },
        toolMetadata: { name: 'Draw', timestamp: '2026-04-30T00:00:00Z' },
      },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'parent-1' } })),
    };

    state.registerLayer(parentLayer, 'parent-1');
    tocLayers.push(parentLayer);
    state.selectLayer('parent-1', { makeActive: true });
    state.setSelectedFeatureIds('parent-1', ['feature-1']);

    const result = state.applyResult({
      addGeojson: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { __id: 'child-1' },
        toolMetadata: {
          name: 'Buffer',
          parentLayerId: 'parent-1',
          timestamp: '2026-04-30T01:00:00Z',
        },
      },
    });

    expect(result.ok).toBe(true);
    const childLayer = state.getLayer('child-1');
    expect(childLayer.feature.properties.toolHistory).toEqual([
      { name: 'Draw', timestamp: '2026-04-30T00:00:00Z' },
      { name: 'Buffer', parentLayerId: 'parent-1', timestamp: '2026-04-30T01:00:00Z' },
    ]);
    expect(state.getActiveLayerId()).toBe('child-1');
    expect(state.getSelectedLayerIds()).toEqual(['child-1']);
    expect(state.getSelectedFeaturesByLayerId()).toEqual({});
  });

  test('applyResult adds FeatureCollection as single group layer', () => {
    const result = state.applyResult({
      addGeojson: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'a' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'b' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 2] }, properties: { name: 'c' } },
        ],
        toolMetadata: { name: 'Add Data', timestamp: '2026-05-01T00:00:00Z' },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(tocLayers).toHaveLength(1);

    const groupLayer = state.getLayer(result.added[0]);
    const groupGeojson = groupLayer.toGeoJSON();
    expect(groupGeojson.features.map((feature) => feature.properties.__id)).toEqual([
      `${result.added[0]}-1`,
      `${result.added[0]}-2`,
      `${result.added[0]}-3`,
    ]);
    expect(state.getActiveLayerId()).toBe(result.added[0]);
    expect(state.getSelectedLayerIds()).toEqual([result.added[0]]);
  });

  test('applyResult coalesces arrays of features into one result layer', () => {
    const result = state.applyResult({
      addGeojson: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'a' }, toolMetadata: { name: 'AI', timestamp: '2026-05-03T00:00:00Z' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'b' } },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(tocLayers).toHaveLength(1);

    const groupLayer = state.getLayer(result.added[0]);
    expect(groupLayer.toGeoJSON()).toEqual(expect.objectContaining({
      type: 'FeatureCollection',
      features: expect.arrayContaining([
        expect.objectContaining({ type: 'Feature' }),
        expect.objectContaining({ type: 'Feature' }),
      ]),
    }));
    expect(groupLayer.feature.properties.toolHistory).toEqual([
      { name: 'AI', timestamp: '2026-05-03T00:00:00Z' },
    ]);
  });

  test('applyResult keeps aggregate single features as one result layer', () => {
    const result = state.applyResult({
      addGeojson: {
        type: 'Feature',
        geometry: {
          type: 'MultiPoint',
          coordinates: [[0, 0], [1, 1]],
        },
        properties: { __id: 'multi-1' },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(tocLayers).toHaveLength(1);
    expect(state.getLayer(result.added[0]).toGeoJSON()).toEqual(expect.objectContaining({
      type: 'Feature',
      geometry: expect.objectContaining({ type: 'MultiPoint' }),
    }));
  });

  test('applyResult adds single Feature individually', () => {
    const result = state.applyResult({
      addGeojson: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { __id: 'single-1' },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(tocLayers).toHaveLength(1);
    expect(state.getLayer('single-1')).not.toBeNull();
  });
  test('setLayerName persists a user-facing layer name', () => {
    const layer = {
      __id: 'layer-1',
      feature: { properties: { __id: 'layer-1' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'layer-1' } })),
    };

    state.registerLayer(layer, 'layer-1');
    expect(state.setLayerName('layer-1', 'Study Area')).toBe(true);
    expect(state.getLayerName('layer-1')).toBe('Study Area');
    expect(layer.feature.properties.layerName).toBe('Study Area');
    expect(layer.feature.properties.displayName).toBe('Study Area');
  });

  test('getLayerInfo exposes canonical geometry, source, provenance, and ui fields', () => {
    const layer = {
      __id: 'import-1',
      feature: {
        properties: {
          __id: 'import-1',
          importSummary: {
            fileName: 'sites.geojson',
            importedCount: 2,
            skippedCount: 0,
          },
          toolHistory: [{ name: 'Add Data', timestamp: '2026-05-01T00:00:00Z' }],
        },
        toolMetadata: {
          name: 'Add Data',
          params: { Input: 'sites.geojson' },
          timestamp: '2026-05-01T00:00:00Z',
        },
      },
      toGeoJSON: jest.fn(() => ({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} },
        ],
        properties: {
          __id: 'import-1',
          importSummary: {
            fileName: 'sites.geojson',
            importedCount: 2,
            skippedCount: 0,
          },
        },
      })),
    };

    state.registerLayer(layer, 'import-1');
    tocLayers.push(layer);
    mockMap.hasLayer.mockImplementation((candidate) => candidate === layer);

    const info = state.getLayerInfo('import-1');

    expect(info.id).toBe('import-1');
    expect(info.displayName).toBe('sites');
    expect(info.geometry).toEqual(expect.objectContaining({
      type: 'Point',
      label: 'Point',
      featureCount: 2,
    }));
    expect(info.source).toEqual(expect.objectContaining({
      kind: 'imported',
      label: 'Imported',
      input: 'sites.geojson',
      importedFileName: 'sites.geojson',
    }));
    expect(info.provenance.history).toEqual([{ name: 'Add Data', timestamp: '2026-05-01T00:00:00Z' }]);
    expect(info.ui).toEqual(expect.objectContaining({ visible: true, selectable: true, removable: true, editable: true }));
  });

  test('listLayers returns canonical display labels and summary fields', () => {
    const layer = {
      __id: 'named-1',
      feature: {
        properties: {
          __id: 'named-1',
          name: 'Parcels',
        },
      },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'named-1', name: 'Parcels' } })),
    };

    state.registerLayer(layer, 'named-1');
    tocLayers.push(layer);

    expect(state.listLayers()).toEqual([
      expect.objectContaining({
        id: 'named-1',
        geometryType: 'Polygon',
        label: 'Parcels',
        displayName: 'Parcels',
        featureCount: 1,
      }),
    ]);
  });

  test('removeLayerTree removes a parent layer and derived descendants', () => {
    const parentLayer = {
      __id: 'parent-2',
      feature: { properties: { __id: 'parent-2' }, toolMetadata: { name: 'Draw' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'parent-2' } })),
    };
    const childLayer = {
      __id: 'child-2',
      feature: { properties: { __id: 'child-2' }, toolMetadata: { name: 'Buffer', parentLayerId: 'parent-2' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'child-2' } })),
    };

    state.registerLayer(parentLayer, 'parent-2');
    state.registerLayer(childLayer, 'child-2');
    tocLayers.push(parentLayer, childLayer);

    expect(state.getChildLayerIds('parent-2')).toEqual(['child-2']);

    const result = state.removeLayerTree('parent-2');

    expect(result.ok).toBe(true);
    expect(result.descendantIds).toEqual(['child-2']);
    expect(state.getLayer('parent-2')).toBeNull();
    expect(state.getLayer('child-2')).toBeNull();
    expect(tocLayers).toHaveLength(0);
  });

  test('handleDrawDeleted removes manual sketches and derived tool result group layers on Clear All (#13)', () => {
    const manualLayer = makeLayer('manual-1', 'Polygon');
    state.registerLayer(manualLayer, 'manual-1');
    tocLayers.push(manualLayer);

    const applied = state.applyResult({
      addGeojson: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'buf-1' } },
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'buf-2' } },
        ],
        toolMetadata: { name: 'Buffer', parentLayerId: 'manual-1' },
      },
    });
    expect(applied.ok).toBe(true);
    expect(tocLayers).toHaveLength(2);

    mockDrawnItems.getLayers = jest.fn(() => []);
    mockDrawnItems.clearLayers = jest.fn();

    const deletedGroup = {
      eachLayer(cb) {
        cb(manualLayer);
      },
    };

    const removedIds = state.handleDrawDeleted(deletedGroup);
    expect(removedIds).toEqual(expect.arrayContaining(['manual-1', ...applied.added]));
    expect(tocLayers).toHaveLength(0);
    expect(state.listLayers()).toEqual([]);
  });

  test('getTocLayerHierarchy organizes derived outputs beneath their parent layer and supports group collapse (#62)', () => {
    const rootA = {
      __id: 'root-a',
      feature: { properties: { __id: 'root-a', name: 'Study Parcels' }, toolMetadata: { name: 'Draw' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'root-a', name: 'Study Parcels' } })),
    };
    const rootB = {
      __id: 'root-b',
      feature: { properties: { __id: 'root-b', name: 'Other Layer' }, toolMetadata: { name: 'Draw' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'root-b', name: 'Other Layer' } })),
    };
    const derivedA1 = {
      __id: 'derived-a1',
      feature: {
        properties: { __id: 'derived-a1', name: 'Buffer of Study Parcels' },
        toolMetadata: { name: 'Buffer', parentLayerId: 'root-a' },
      },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'derived-a1' } })),
    };
    const derivedA2 = {
      __id: 'derived-a2',
      feature: {
        properties: { __id: 'derived-a2', name: 'Clip of Buffer' },
        toolMetadata: { name: 'Clip', parentLayerId: 'derived-a1' },
      },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { __id: 'derived-a2' } })),
    };

    state.registerLayer(rootA, 'root-a');
    state.registerLayer(rootB, 'root-b');
    state.registerLayer(derivedA1, 'derived-a1');
    state.registerLayer(derivedA2, 'derived-a2');
    // Push in interleaved order to verify hierarchy groups children beneath root-a
    tocLayers.push(rootA, rootB, derivedA1, derivedA2);

    const hierarchy = state.getTocLayerHierarchy();
    expect(hierarchy.map((node) => ({
      id: node.id,
      depth: node.depth,
      parentLayerId: node.parentLayerId,
      childIds: node.childIds,
      hidden: node.hiddenByCollapsedAncestor,
    }))).toEqual([
      { id: 'root-a', depth: 0, parentLayerId: null, childIds: ['derived-a1'], hidden: false },
      { id: 'derived-a1', depth: 1, parentLayerId: 'root-a', childIds: ['derived-a2'], hidden: false },
      { id: 'derived-a2', depth: 2, parentLayerId: 'derived-a1', childIds: [], hidden: false },
      { id: 'root-b', depth: 0, parentLayerId: null, childIds: [], hidden: false },
    ]);

    expect(state.toggleLayerGroupCollapsed('root-a')).toBe(true);
    expect(state.isLayerGroupCollapsed('root-a')).toBe(true);

    const collapsedHierarchy = state.getTocLayerHierarchy();
    expect(collapsedHierarchy.find((n) => n.id === 'derived-a1').hiddenByCollapsedAncestor).toBe(true);
    expect(collapsedHierarchy.find((n) => n.id === 'derived-a2').hiddenByCollapsedAncestor).toBe(true);
    expect(collapsedHierarchy.find((n) => n.id === 'root-b').hiddenByCollapsedAncestor).toBe(false);
  });

  test('applyResult applies distinct comparison diff styles to CompareTool features', () => {
    const setStyleCalls = [];
    global.L.geoJSON = jest.fn((gj, options) => {
      const features = gj.type === 'FeatureCollection' ? gj.features : [gj];
      const children = features.map((feature, index) => ({
        feature,
        __id: feature.properties?.__id || `cmp-${index + 1}`,
        addTo: jest.fn(),
        setStyle: jest.fn((style) => setStyleCalls.push({ role: feature.properties?.comparisonRole, style })),
        toGeoJSON: jest.fn(() => feature),
      }));
      return {
        eachLayer(cb) { children.forEach(cb); },
        addTo: jest.fn(),
        feature: null,
        toGeoJSON: jest.fn(() => gj),
        __id: undefined,
        __options: options,
      };
    });

    const comparisonCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
          properties: { __id: 'cmp-int', comparisonRole: 'intersection' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[1, 0], [1, 1], [2, 1], [2, 0], [1, 0]]] },
          properties: { __id: 'cmp-a', comparisonRole: 'only-in-a' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[-1, 0], [-1, 1], [0, 1], [0, 0], [-1, 0]]] },
          properties: { __id: 'cmp-b', comparisonRole: 'only-in-b' },
        },
      ],
      toolMetadata: {
        name: 'Compare',
        comparison: {
          layerAId: 'a',
          layerBId: 'b',
          jaccardSimilarity: 0.5,
          areaDeltaSqm: 100,
        },
      },
    };

    const res = state.applyResult({ addGeojson: comparisonCollection });
    expect(res.ok).toBe(true);
    expect(global.L.geoJSON).toHaveBeenCalledWith(
      comparisonCollection,
      expect.objectContaining({ style: expect.any(Function) })
    );
    expect(setStyleCalls).toEqual([
      {
        role: 'intersection',
        style: expect.objectContaining({ color: '#38bdf8', fillColor: '#38bdf8' }),
      },
      {
        role: 'only-in-a',
        style: expect.objectContaining({ color: '#f59e0b', fillColor: '#f59e0b', dashArray: '5 4' }),
      },
      {
        role: 'only-in-b',
        style: expect.objectContaining({ color: '#ec4899', fillColor: '#ec4899', dashArray: '2 4' }),
      },
    ]);
  });

  test('applyResult renders GroupTool point features as circleMarkers colored by groupId', () => {
    const circleMarkerCalls = [];
    global.L.circleMarker = jest.fn((latlng, style) => {
      circleMarkerCalls.push({ latlng, style });
      return { latlng, style, addTo: jest.fn(), setStyle: jest.fn() };
    });

    let capturedOptions = null;
    global.L.geoJSON = jest.fn((gj, options) => {
      capturedOptions = options;
      const features = gj.type === 'FeatureCollection' ? gj.features : [gj];
      const children = features.map((feature, index) => {
        if (options?.pointToLayer && feature.geometry?.type === 'Point') {
          options.pointToLayer(feature, { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] });
        }
        return {
          feature,
          __id: feature.properties?.__id || `grp-${index + 1}`,
          addTo: jest.fn(),
          setStyle: jest.fn(),
          toGeoJSON: jest.fn(() => feature),
        };
      });
      return {
        eachLayer(cb) { children.forEach(cb); },
        addTo: jest.fn(),
        feature: null,
        toGeoJSON: jest.fn(() => gj),
        __id: undefined,
      };
    });

    const groupedCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.2, 34.0] },
          properties: { __id: 'p-1', groupId: 'group-1', groupSize: 2 },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.3, 34.1] },
          properties: { __id: 'p-2', groupId: 'group-2', groupSize: 2 },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.4, 34.2] },
          properties: { __id: 'p-3', groupId: null, groupSize: 1 },
        },
      ],
      toolMetadata: {
        name: 'Group',
        result: {
          groupCount: 2,
          ungroupedCount: 1,
          groups: [
            { groupId: 'group-1', featureCount: 1 },
            { groupId: 'group-2', featureCount: 1 },
          ],
        },
      },
    };

    const res = state.applyResult({ addGeojson: groupedCollection });
    expect(res.ok).toBe(true);
    expect(typeof capturedOptions?.pointToLayer).toBe('function');
    expect(circleMarkerCalls.map((c) => c.style.fillColor)).toEqual(['#38bdf8', '#f59e0b', '#94a3b8']);
  });
});
