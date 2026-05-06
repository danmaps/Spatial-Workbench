const turf = require('@turf/turf');

jest.mock('@turf/turf', () => ({
  buffer: jest.fn(),
  randomPoint: jest.fn(),
  bbox: jest.fn(() => [0, 0, 1, 1]),
  booleanPointInPolygon: jest.fn(() => true),
  centroid: jest.fn(),
  clustersDbscan: jest.fn(),
}));

jest.mock('./state', () => ({
  getLayer: jest.fn(),
  listLayers: jest.fn(() => []),
  applyResult: jest.fn(),
}));

describe('headless runtime', () => {
  beforeEach(() => {
    jest.resetModules();
    global.turf = turf;
    global.L = {
      Polygon: function Polygon() {},
    };
    turf.buffer.mockReset();
    turf.randomPoint.mockReset();
    turf.bbox.mockReset();
    turf.bbox.mockReturnValue([0, 0, 1, 1]);
    turf.booleanPointInPolygon.mockReset();
    turf.booleanPointInPolygon.mockReturnValue(true);
    turf.centroid.mockReset();
    turf.clustersDbscan.mockReset();
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
        bbox: [-1, -1, 1, 1],
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      tool: 'BufferTool',
      status: expect.objectContaining({ code: 0, message: 'Buffered layer added to map.' }),
      output: expect.objectContaining({ ok: true, added: expect.any(Array), removed: [] }),
      state: expect.objectContaining({
        added: expect.any(Array),
        removed: [],
        layers: expect.any(Array),
        bbox: [-1, -1, 1, 1],
      }),
    }));
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

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      tool: 'RandomPointsTool',
      status: expect.objectContaining({ code: 0, message: 'Added 2 point(s).' }),
      output: expect.objectContaining({ ok: true, added: expect.any(Array), removed: [] }),
      state: expect.objectContaining({
        added: expect.any(Array),
        removed: [],
        layers: expect.any(Array),
        bbox: [0, 0, 1, 1],
      }),
    }));
    expect(turf.randomPoint).toHaveBeenCalledWith(2, { bbox: [0, 0, 1, 1] });
    expect(result.state.added).toHaveLength(1);
    expect(result.state.layers[0].geojson.features).toHaveLength(2);
  });

  test('runHeadlessTool executes RandomPointsTool inside a request-scoped polygon layer', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    turf.randomPoint.mockReturnValue({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0.5, 0.5] }, properties: {} }],
    });

    const result = await runHeadlessTool({
      tool: 'RandomPointsTool',
      params: {
        'Points Count': 2,
        'Inside Polygon': true,
        Polygon: 'polygon-layer',
      },
      state: {
        layers: [
          {
            id: 'polygon-layer',
            name: 'Polygon Layer',
            geojson: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [0, 0],
                  [0, 1],
                  [1, 1],
                  [1, 0],
                  [0, 0],
                ]],
              },
            },
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toEqual(expect.objectContaining({ code: 0, message: 'Added 2 point(s).' }));
    expect(turf.bbox).toHaveBeenCalled();
    expect(turf.randomPoint).toHaveBeenCalledTimes(2);
    expect(turf.booleanPointInPolygon).toHaveBeenCalledTimes(2);
    expect(result.state.added).toHaveLength(1);
    expect(result.state.layers).toHaveLength(2);
    expect(result.state.layers[1].geojson.features).toHaveLength(2);
  });

  test('runHeadlessTool executes BufferTool against selected features when present', async () => {
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
              features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
                { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
              ],
            },
          },
        ],
        selection: {
          activeLayerId: 'source-layer',
          selectedLayerIds: ['source-layer'],
          selectedFeaturesByLayerId: {
            'source-layer': ['feature-2'],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toEqual(expect.objectContaining({ code: 0, message: 'Buffered 1 selected feature(s).' }));
    expect(turf.buffer).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ __id: 'feature-2' }) }),
      ],
    }, 5, { units: 'miles' });
    expect(result.state.selection).toEqual(expect.objectContaining({
      activeLayerId: 'source-layer',
      selectedLayerIds: ['source-layer'],
      selectedFeaturesByLayerId: { 'source-layer': ['feature-2'] },
    }));
  });

  test('runHeadlessTool executes GroupTool against selected features', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    turf.clustersDbscan.mockReturnValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __sourceFeatureId: 'feature-2', cluster: 0, dbscan: 'core' } },
      ],
    });

    const result = await runHeadlessTool({
      tool: 'GroupTool',
      params: {
        Layer: 'source-layer',
        Distance: 2,
        Units: 'kilometers',
      },
      state: {
        layers: [
          {
            id: 'source-layer',
            name: 'Source Layer',
            geojson: {
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
                { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
              ],
            },
          },
        ],
        selection: {
          activeLayerId: 'source-layer',
          selectedLayerIds: ['source-layer'],
          selectedFeaturesByLayerId: {
            'source-layer': ['feature-2'],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('GroupTool');
    expect(result.status).toEqual(expect.objectContaining({
      code: 0,
      message: 'Grouped 1 selected feature(s) into 1 group(s).',
    }));
    expect(turf.clustersDbscan).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({ properties: { __sourceFeatureId: 'feature-2' } }),
      ],
    }, 2, { units: 'kilometers' });
    expect(result.state.added).toHaveLength(1);
    expect(result.state.layers).toHaveLength(2);
    expect(result.state.layers[1]).toEqual(expect.objectContaining({
      name: 'Group',
      geojson: expect.objectContaining({
        type: 'FeatureCollection',
        features: [
          expect.objectContaining({ properties: expect.objectContaining({ __id: 'feature-2', groupId: 'group-0' }) }),
        ],
        toolMetadata: expect.objectContaining({
          target: expect.objectContaining({ mode: 'selection', selectedFeatureIds: ['feature-2'] }),
        }),
      }),
    }));
  });

  test('runHeadlessTool executes ExportTool and returns a download payload without mutating state', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    const sourceGeojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { id: 1 } }],
    };

    const result = await runHeadlessTool({
      tool: 'ExportTool',
      params: {
        Layer: 'export-me',
        Format: 'GeoJSON',
      },
      state: {
        layers: [
          {
            id: 'export-me',
            name: 'Export Me',
            geojson: sourceGeojson,
          },
        ],
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      tool: 'ExportTool',
      status: expect.objectContaining({ code: 0, message: 'Prepared GeoJSON export.' }),
      output: expect.objectContaining({
        download: expect.objectContaining({
          filename: 'export-me.geojson',
          mimeType: 'application/json',
          data: JSON.stringify(sourceGeojson),
        }),
      }),
      state: expect.objectContaining({
        added: [],
        removed: [],
        bbox: null,
      }),
    }));
    expect(result.state.layers).toEqual([
      expect.objectContaining({ id: 'export-me', name: 'Export Me', geojson: sourceGeojson }),
    ]);
  });

  test('runHeadlessTool exports selected features when present', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    const sourceGeojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { __id: 'feature-1', id: 1 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 6] }, properties: { __id: 'feature-2', id: 2 } },
      ],
    };

    const result = await runHeadlessTool({
      tool: 'ExportTool',
      params: {
        Layer: 'export-me',
        Format: 'GeoJSON',
      },
      state: {
        layers: [
          {
            id: 'export-me',
            name: 'Export Me',
            geojson: sourceGeojson,
          },
        ],
        selection: {
          activeLayerId: 'export-me',
          selectedLayerIds: ['export-me'],
          selectedFeaturesByLayerId: { 'export-me': ['feature-2'] },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toEqual(expect.objectContaining({ code: 0, message: 'Prepared GeoJSON export for 1 selected feature(s).' }));
    expect(result.output).toEqual(expect.objectContaining({
      download: expect.objectContaining({
        filename: 'export-me-selection.geojson',
      }),
    }));
    expect(JSON.parse(result.output.download.data)).toEqual({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({
          type: 'Feature',
          geometry: sourceGeojson.features[1].geometry,
          properties: sourceGeojson.features[1].properties,
          id: 'feature-2',
        }),
      ],
    });
  });

  test('runHeadlessTool keeps request state isolated between runs', async () => {
    const { runHeadlessTool } = require('./headless-runtime');

    turf.buffer.mockReturnValue({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }],
    });

    const firstResult = await runHeadlessTool({
      tool: 'BufferTool',
      params: {
        'Input Layer': 'source-layer',
        Distance: 1,
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

    const secondResult = await runHeadlessTool({
      tool: 'ExportTool',
      params: {
        Layer: firstResult.state.added[0].id,
        Format: 'GeoJSON',
      },
      state: {
        layers: [],
      },
    });

    expect(firstResult.ok).toBe(true);
    expect(firstResult.state.added).toHaveLength(1);
    expect(secondResult.ok).toBe(false);
    expect(secondResult.status).toEqual(expect.objectContaining({ code: 2, message: 'No layer selected.' }));
    expect(secondResult.output).toBe(null);
    expect(secondResult.state).toEqual(expect.objectContaining({
      added: [],
      removed: [],
      layers: [],
    }));
  });
});
