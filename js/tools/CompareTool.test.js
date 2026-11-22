const turf = require('@turf/turf');
const { CompareTool } = require('./CompareTool');
const { runHeadlessTool } = require('../headless-runtime');

global.turf = turf;

const POLYGON_A = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { __id: 'a-1', name: 'Baseline Parcel' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.25, 34.04],
            [-118.23, 34.04],
            [-118.23, 34.06],
            [-118.25, 34.06],
            [-118.25, 34.04],
          ],
        ],
      },
    },
  ],
};

const POLYGON_B = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { __id: 'b-1', name: 'Candidate Parcel' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.24, 34.04],
            [-118.22, 34.04],
            [-118.22, 34.06],
            [-118.24, 34.06],
            [-118.24, 34.04],
          ],
        ],
      },
    },
  ],
};

describe('CompareTool (#46)', () => {
  test('computes intersection, only-in-a, only-in-b, and area/jaccard metrics and chains into ExportTool', async () => {
    const compareRun = await runHeadlessTool({
      tool: 'CompareTool',
      params: {
        'Layer A': 'parcel-a',
        'Layer B': 'parcel-b',
      },
      state: {
        layers: [
          { id: 'parcel-a', name: 'Baseline A', geojson: POLYGON_A },
          { id: 'parcel-b', name: 'Candidate B', geojson: POLYGON_B },
        ],
      },
    });

    expect(compareRun.ok).toBe(true);
    expect(compareRun.status.code).toBe(0);
    expect(compareRun.status.message).toContain('Compared parcel-a vs parcel-b');

    const metrics = compareRun.output.comparison;
    expect(metrics).toEqual(
      expect.objectContaining({
        layerAId: 'parcel-a',
        layerBId: 'parcel-b',
        areaASqm: expect.any(Number),
        areaBSqm: expect.any(Number),
        intersectionAreaSqm: expect.any(Number),
        onlyInAAreaSqm: expect.any(Number),
        onlyInBAreaSqm: expect.any(Number),
        areaDeltaSqm: expect.any(Number),
        jaccardSimilarity: expect.any(Number),
        componentCounts: {
          intersection: 1,
          onlyInA: 1,
          onlyInB: 1,
        },
      })
    );
    expect(metrics.intersectionAreaSqm).toBeGreaterThan(0);
    expect(metrics.onlyInAAreaSqm).toBeGreaterThan(0);
    expect(metrics.onlyInBAreaSqm).toBeGreaterThan(0);
    expect(metrics.jaccardSimilarity).toBeGreaterThan(0.3);
    expect(metrics.jaccardSimilarity).toBeLessThan(0.4);

    const outputLayerId = compareRun.state.added[0].id;
    const outputLayer = compareRun.state.layers.find((l) => l.id === outputLayerId);
    expect(outputLayer.geojson.features.map((f) => f.properties.comparisonRole)).toEqual([
      'intersection',
      'only-in-a',
      'only-in-b',
    ]);

    const exportRun = await runHeadlessTool({
      tool: 'ExportTool',
      params: {
        Layer: outputLayerId,
        Format: 'GeoJSON',
      },
      state: compareRun.state,
    });
    expect(exportRun.ok).toBe(true);
    const exported = JSON.parse(exportRun.output.download.data);
    expect(exported.features).toHaveLength(3);
    expect(exported.toolHistory.map((h) => h.name)).toEqual(['Compare', 'Export']);
  });

  test('validates missing or non-polygon layers', async () => {
    const tool = new CompareTool();
    const validation = await tool.validate(
      { 'Layer A': 'missing-a', 'Layer B': 'missing-b' },
      { getLayer: () => null, state: {} }
    );
    expect(validation).toEqual({
      ok: false,
      errors: ['No baseline Layer A selected.', 'No comparison Layer B selected.'],
    });
  });
});
