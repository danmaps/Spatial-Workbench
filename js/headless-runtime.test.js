const turf = require('@turf/turf');

jest.mock('@turf/turf', () => ({
  buffer: jest.fn(),
  randomPoint: jest.fn(),
  bbox: jest.fn(() => [0, 0, 1, 1]),
  booleanPointInPolygon: jest.fn(() => true),
}));

jest.mock('./state', () => ({
  getLayer: jest.fn(),
  listLayers: jest.fn(() => []),
  applyResult: jest.fn(),
}));

describe('headless runtime', () => {
  beforeEach(() => {
    global.turf = turf;
    global.L = {
      Polygon: function Polygon() {},
    };
    turf.buffer.mockReset();
    turf.randomPoint.mockReset();
    turf.booleanPointInPolygon.mockReset();
  });

  test('runHeadlessTool executes BufferTool against request-scoped layers', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    turf.buffer.mockReturnValue({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }],
    });

    const result = await runHeadlessTool({
      tool: 'BufferTool',
      params: {
        'Input Layer': 'source-layer',
        Distance: 5,
        Units: 'miles',
      },
      state: {
        layers: [
          {
            id: 'source-layer',
            name: 'Source Layer',
            geojson: {
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }],
            },
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status.code).toBe(0);
    expect(turf.buffer).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FeatureCollection' }),
      5,
      { units: 'miles' }
    );
    expect(result.state.added).toHaveLength(1);
    expect(result.state.layers).toHaveLength(2);
  });

  test('runHeadlessTool executes RandomPointsTool with bbox bounds', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    turf.randomPoint.mockReturnValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} },
      ],
    });

    const result = await runHeadlessTool({
      tool: 'RandomPointsTool',
      params: {
        'Points Count': 2,
        'Inside Polygon': false,
      },
      state: {
        bbox: [0, 0, 1, 1],
      },
    });

    expect(result.ok).toBe(true);
    expect(turf.randomPoint).toHaveBeenCalledWith(2, { bbox: [0, 0, 1, 1] });
    expect(result.state.added).toHaveLength(1);
  });
});
