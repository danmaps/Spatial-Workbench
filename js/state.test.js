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
    // Should produce exactly one layer in TOC, not three
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
});