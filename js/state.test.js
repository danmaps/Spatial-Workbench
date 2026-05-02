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
      geoJSON: jest.fn((gj) => ({
        eachLayer(cb) {
          const features = gj.type === 'FeatureCollection' ? gj.features : [gj];
          features.forEach((feature, index) => {
            cb({
              feature,
              __id: feature.properties?.__id || `child-${index}`,
              addTo: jest.fn(),
              toGeoJSON: jest.fn(() => feature),
            });
          });
        },
      })),
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
