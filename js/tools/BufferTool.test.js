const L = require('leaflet');
const turf = require('@turf/turf');

jest.mock('leaflet');
jest.mock('@turf/turf', () => ({
  buffer: jest.fn(),
}));

jest.mock('../app', () => ({
  map: {},
}));

const mockApplyResult = jest.fn(() => ({ ok: true, added: ['buffered-layer'], removed: [], errors: [] }));
const mockGetLayer = jest.fn();
const mockListLayers = jest.fn(() => []);

jest.mock('../state', () => ({
  getLayer: (...args) => mockGetLayer(...args),
  listLayers: (...args) => mockListLayers(...args),
  applyResult: (...args) => mockApplyResult(...args),
}));

describe('BufferTool', () => {
  let BufferTool;

  beforeEach(() => {
    jest.resetModules();
    mockApplyResult.mockClear();
    mockGetLayer.mockClear();
    mockListLayers.mockClear();

    global.L = L;
    global.turf = turf;

    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
      <div id="toolContent"></div>
      <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>

      <select id="param-Input Layer"><option value="input-1">input-1</option></select>
      <input id="param-Distance" value="10" />
      <select id="param-Units"><option value="miles">miles</option></select>
    `;

    ({ BufferTool } = require('./BufferTool'));
  });

  test('run sends a single FeatureCollection result to applyResult', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 1 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 2 } },
      ],
    };

    mockGetLayer.mockReturnValue({
      toGeoJSON: jest.fn(() => sourceGeoJSON),
    });

    turf.buffer.mockReturnValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: 1 } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: 2 } },
      ],
    });

    const tool = new BufferTool();
    const result = await tool.run({
      'Input Layer': 'input-1',
      Distance: 10,
      Units: 'miles',
    });

    expect(turf.buffer).toHaveBeenCalledWith(sourceGeoJSON, 10, { units: 'miles' });
    expect(mockApplyResult).toHaveBeenCalledWith({
      addGeojson: expect.objectContaining({
        type: 'FeatureCollection',
        features: expect.arrayContaining([
          expect.objectContaining({ type: 'Feature' }),
          expect.objectContaining({ type: 'Feature' }),
        ]),
        toolMetadata: expect.objectContaining({
          name: 'Buffer',
          parentLayerId: 'input-1',
          params: expect.objectContaining({ 'Input Layer': 'input-1', Distance: 10, Units: 'miles' }),
        }),
      }),
    });
    expect(result.ok).toBe(true);
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Buffered layer added to map.',
    }));
  });
});
