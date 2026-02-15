const L = require('leaflet');
const turf = require('@turf/turf');

jest.mock('leaflet');
jest.mock('@turf/turf', () => ({
    randomPoint: jest.fn(),
    bbox: jest.fn(() => [0, 0, 1, 1]),
    booleanPointInPolygon: jest.fn(),
}));

jest.mock('../app', () => ({
    map: {},
}));

jest.mock('../state', () => ({
    getLayer: jest.fn(),
    listLayers: jest.fn(() => []),
    applyResult: jest.fn(() => ({ ok: true, added: [{ id: 'x' }], removed: [], errors: [] })),
}));

describe('RandomPointsTool', () => {
    let RandomPointsTool;

    beforeEach(() => {
        global.L = L;
        global.turf = turf;

        // Minimal DOM expected by Tool base class
        document.body.innerHTML = `
          <div id="toolSelection" style="display:block"></div>
          <div id="toolDetails" class="hidden"></div>
          <div id="toolContent"></div>
          <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>

          <input id="param-Points Count" value="5" />
          <input id="param-Inside Polygon" type="checkbox" checked />
          <select id="param-Polygon"><option value="123" selected>123</option></select>
        `;

        ({ RandomPointsTool } = require('./RandomPointsTool'));

        turf.randomPoint.mockClear();
        turf.booleanPointInPolygon.mockClear();
        turf.bbox.mockClear();

        const state = require('../state');
        state.getLayer.mockReset();
        state.applyResult.mockClear();
    });

    test('execute (inside polygon)', () => {
        const state = require('../state');

        const mockPolygon = {
            toGeoJSON: jest.fn(() => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } })),
        };

        // satisfy: polygonLayer instanceof L.Polygon
        L.Polygon = function () { };
        Object.setPrototypeOf(mockPolygon, L.Polygon.prototype);

        state.getLayer.mockReturnValue(mockPolygon);
        turf.randomPoint.mockReturnValue({ features: [{ properties: {} }] });
        turf.booleanPointInPolygon.mockReturnValue(true);

        const tool = new RandomPointsTool();
        tool.execute();

        expect(state.getLayer).toHaveBeenCalled();
        expect(turf.randomPoint).toHaveBeenCalled();
        expect(turf.booleanPointInPolygon).toHaveBeenCalled();
        expect(state.applyResult).toHaveBeenCalled();
    });

    test('renderUI', () => {
        const tool = new RandomPointsTool();
        tool.renderUI();

        // Tool base class should have cleared/rebuilt toolContent
        expect(document.getElementById('toolContent').innerHTML).toContain('Random Points');
    });
});
