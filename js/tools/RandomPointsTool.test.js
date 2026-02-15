const L = require('leaflet');
const turf = require('@turf/turf');

jest.mock('leaflet');
jest.mock('@turf/turf', () => ({
  randomPoint: jest.fn(),
  bbox: jest.fn(() => [0, 0, 1, 1]),
  booleanPointInPolygon: jest.fn(() => true),
}));

jest.mock('../app', () => ({
  map: {
    getBounds: jest.fn(() => ({
      getSouthWest: () => ({ lng: 0, lat: 0 }),
      getNorthEast: () => ({ lng: 1, lat: 1 }),
    })),
  },
}));

const mockApplyResult = jest.fn(() => ({ ok: true, added: [{ id: 'x' }], removed: [], errors: [] }));
const mockGetLayer = jest.fn();
const mockListLayers = jest.fn(() => []);

jest.mock('../state', () => ({
  getLayer: (...args) => mockGetLayer(...args),
  listLayers: (...args) => mockListLayers(...args),
  applyResult: (...args) => mockApplyResult(...args),
}));

describe('RandomPointsTool', () => {
  let RandomPointsTool;

  beforeEach(() => {
    mockApplyResult.mockClear();
    mockGetLayer.mockClear();
    mockListLayers.mockClear();

    global.L = L;
    global.turf = turf;

    // Minimal DOM expected by Tool base class
    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
      <div id="toolContent"></div>
      <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>

      <input id="param-Points Count" value="3" />
      <input id="param-Inside Polygon" type="checkbox" />
      <select id="param-Polygon"><option value="poly-1">poly-1</option></select>
    `;

    // Require after mocks
    ({ RandomPointsTool } = require('./RandomPointsTool'));

    turf.randomPoint.mockClear();
    turf.booleanPointInPolygon.mockClear();
    turf.bbox.mockClear();
  });

  test('execute adds points via applyResult (bounds mode)', () => {
    // insidePolygon unchecked by default
    turf.randomPoint.mockReturnValue({ type: 'FeatureCollection', features: [] });

    const tool = new RandomPointsTool();
    tool.execute();

    expect(turf.randomPoint).toHaveBeenCalled();
    expect(mockApplyResult).toHaveBeenCalled();
  });

  test('execute adds points via applyResult (inside polygon mode)', () => {
    // Toggle inside polygon
    document.getElementById('param-Inside Polygon').checked = true;
    document.getElementById('param-Polygon').value = 'poly-1';

    const poly = { toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } })) };

    // satisfy: polygonLayer instanceof L.Polygon
    L.Polygon = function Polygon() {};
    Object.setPrototypeOf(poly, L.Polygon.prototype);

    mockGetLayer.mockReturnValue(poly);
    turf.randomPoint.mockReturnValue({ features: [{ properties: {} }] });

    const tool = new RandomPointsTool();
    tool.execute();

    expect(mockGetLayer).toHaveBeenCalled();
    expect(turf.randomPoint).toHaveBeenCalled();
    expect(turf.booleanPointInPolygon).toHaveBeenCalled();
    expect(mockApplyResult).toHaveBeenCalled();
  });

  test('renderUI lists polygons via listLayers', () => {
    mockListLayers.mockReturnValue([{ id: 'p1', geometryType: 'Polygon', label: 'Polygon (p1)' }]);

    const tool = new RandomPointsTool();
    tool.renderUI();

    expect(mockListLayers).toHaveBeenCalled();
  });
});
