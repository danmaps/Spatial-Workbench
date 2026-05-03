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

  test('ensureToolHistory stores current metadata on a layer', () => {
    const layer = { feature: { properties: {} } };
    const history = state.ensureToolHistory(layer, { name: 'Draw', timestamp: '2026-04-30T00:00:00Z' });

    expect(history).toEqual([{ name: 'Draw', timestamp: '2026-04-30T00:00:00Z' }]);
    expect(layer.feature.properties.toolHistory).toHaveLength(1);
  });

  test('applyResult inherits parent history and appends child tool metadata', () => {
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
});
