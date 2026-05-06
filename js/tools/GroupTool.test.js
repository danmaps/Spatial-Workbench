const turf = require('@turf/turf');

jest.mock('@turf/turf', () => ({
  centroid: jest.fn(),
  clustersDbscan: jest.fn(),
}));

const mockApplyResult = jest.fn(() => ({ ok: true, added: ['grouped-layer'], removed: [], errors: [] }));
const mockListLayers = jest.fn(() => []);

jest.mock('../state', () => ({
  listLayers: (...args) => mockListLayers(...args),
  applyResult: (...args) => mockApplyResult(...args),
}));

describe('GroupTool', () => {
  let GroupTool;

  beforeEach(() => {
    jest.resetModules();
    mockApplyResult.mockClear();
    mockListLayers.mockClear();
    turf.centroid.mockReset();
    turf.clustersDbscan.mockReset();
    global.turf = turf;

    ({ GroupTool } = require('./GroupTool'));
  });

  test('run groups only selected features and adds one grouped result layer', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1', name: 'a' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2', name: 'b' } },
      ],
    };

    turf.clustersDbscan.mockReturnValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __sourceFeatureId: 'feature-2', cluster: 0, dbscan: 'core' } },
      ],
    });

    const tool = new GroupTool();
    const result = await tool.run({
      Layer: 'input-1',
      Distance: 10,
      Units: 'kilometers',
    }, {
      getLayer: () => ({
        toGeoJSON: jest.fn(() => sourceGeoJSON),
      }),
      applyResult: mockApplyResult,
      state: {
        selection: {
          activeLayerId: 'input-1',
          selectedLayerIds: ['input-1'],
          selectedFeaturesByLayerId: { 'input-1': ['feature-2'] },
        },
      },
    });

    expect(turf.clustersDbscan).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({ properties: { __sourceFeatureId: 'feature-2' } }),
      ],
    }, 10, { units: 'kilometers' });
    expect(mockApplyResult).toHaveBeenCalledWith({
      addGeojson: expect.objectContaining({
        type: 'FeatureCollection',
        features: [
          expect.objectContaining({
            properties: expect.objectContaining({
              __id: 'feature-2',
              groupId: 'group-0',
              grouped: true,
              groupStatus: 'grouped',
              groupSize: 1,
            }),
          }),
        ],
        toolMetadata: expect.objectContaining({
          name: 'Group',
          parentLayerId: 'input-1',
          target: expect.objectContaining({
            mode: 'selection',
            selectedFeatureIds: ['feature-2'],
            selectedFeatureCount: 1,
            totalFeatureCount: 2,
          }),
          result: expect.objectContaining({
            groupCount: 1,
            ungroupedCount: 0,
          }),
        }),
      }),
    });
    expect(result.ok).toBe(true);
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Grouped 1 selected feature(s) into 1 group(s).',
    }));
  });

  test('run groups mixed geometry layers using centroids for non-point features', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]],
          },
          properties: { __id: 'poly-1' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { __id: 'point-1' } },
      ],
    };

    turf.centroid.mockReturnValue({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 1] },
      properties: {},
    });
    turf.clustersDbscan.mockReturnValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __sourceFeatureId: 'poly-1', cluster: 0, dbscan: 'core' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { __sourceFeatureId: 'point-1', dbscan: 'noise' } },
      ],
    });

    const tool = new GroupTool();
    await tool.run({
      Layer: 'input-2',
      Distance: 5,
      Units: 'miles',
    }, {
      getLayer: () => ({
        toGeoJSON: jest.fn(() => sourceGeoJSON),
      }),
      applyResult: mockApplyResult,
      state: { selection: {} },
    });

    expect(turf.centroid).toHaveBeenCalledTimes(1);
    expect(mockApplyResult).toHaveBeenCalledWith({
      addGeojson: expect.objectContaining({
        features: [
          expect.objectContaining({ properties: expect.objectContaining({ __id: 'poly-1', groupId: 'group-0', groupStatus: 'grouped' }) }),
          expect.objectContaining({ properties: expect.objectContaining({ __id: 'point-1', groupId: null, groupStatus: 'ungrouped' }) }),
        ],
      }),
    });
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Grouped 2 feature(s) into 1 group(s), 1 ungrouped.',
    }));
  });

  test('run rejects invalid distance values', async () => {
    const tool = new GroupTool();
    const result = await tool.run({
      Layer: 'input-1',
      Distance: 0,
      Units: 'kilometers',
    }, {
      getLayer: () => ({ toGeoJSON: jest.fn(() => ({ type: 'FeatureCollection', features: [] })) }),
      applyResult: mockApplyResult,
      state: { selection: {} },
    });

    expect(result).toBeUndefined();
    expect(mockApplyResult).not.toHaveBeenCalled();
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 2,
      message: 'Distance must be greater than 0.',
    }));
  });
});
