const { RandomPointsTool } = require('./RandomPointsTool');

jest.mock('../app', () => ({
  drawnItems: {},
  map: { getBounds: jest.fn() },
}));

const mockApplyResult = jest.fn();
const mockGetLayer = jest.fn();
const mockListLayers = jest.fn();

jest.mock('../state', () => ({
  getLayer: (...args) => mockGetLayer(...args),
  listLayers: (...args) => mockListLayers(...args),
  applyResult: (...args) => mockApplyResult(...args),
}));

describe('RandomPointsTool', () => {
  beforeEach(() => {
    mockApplyResult.mockReset();
    mockGetLayer.mockReset();
    mockListLayers.mockReset();

    // Minimal DOM stubs
    document.getElementById = jest.fn((id) => {
      switch (id) {
        case 'param-Points Count':
          return { value: '3' };
        case 'param-Inside Polygon':
          return { checked: false };
        case 'param-Polygon':
          return { value: 'stable-id-1' };
        default:
          return null;
      }
    });

    // Turf is global in the app; provide the bits the tool uses.
    global.turf = {
      randomPoint: jest.fn(() => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] })),
      bbox: jest.fn(() => [0, 0, 1, 1]),
      booleanPointInPolygon: jest.fn(() => true),
    };

    // Leaflet global
    global.L = {
      Polygon: function Polygon() {},
    };
  });

  test('execute adds points via applyResult', () => {
    const tool = new RandomPointsTool();
    tool.execute();
    expect(mockApplyResult).toHaveBeenCalled();
  });

  test('renderUI lists polygons via listLayers', () => {
    mockListLayers.mockReturnValue([{ id: 'p1', geometryType: 'Polygon', label: 'Polygon (p1)' }]);
    const tool = new RandomPointsTool();

    const polygonEl = { innerHTML: '', appendChild: jest.fn() };
    document.getElementById = jest.fn((id) => (id === 'param-Polygon' ? polygonEl : null));

    tool.renderUI();
    expect(mockListLayers).toHaveBeenCalled();
    expect(polygonEl.appendChild).toHaveBeenCalled();
  });
});
