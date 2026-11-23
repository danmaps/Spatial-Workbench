const turf = require('@turf/turf');
const { runHeadlessTool } = require('../headless-runtime');

global.turf = turf;

const PARCELS_LAYER = {
  id: 'parcels',
  name: 'Zoning Parcels',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { __id: 'p-1', zone: 'Residential' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-118.25, 34.04],
              [-118.24, 34.04],
              [-118.24, 34.05],
              [-118.25, 34.05],
              [-118.25, 34.04],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { __id: 'p-2', zone: 'Residential' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-118.24, 34.04],
              [-118.23, 34.04],
              [-118.23, 34.05],
              [-118.24, 34.05],
              [-118.24, 34.04],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { __id: 'p-3', zone: 'Commercial' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-118.25, 34.05],
              [-118.24, 34.05],
              [-118.24, 34.06],
              [-118.25, 34.06],
              [-118.25, 34.05],
            ],
          ],
        },
      },
    ],
  },
};

describe('DissolveTool (#166)', () => {
  test('dissolves polygons grouped by a shared attribute field', async () => {
    const grouped = await runHeadlessTool({
      tool: 'DissolveTool',
      params: {
        'Input Layer': 'parcels',
        'Dissolve Field': 'zone',
      },
      state: {
        layers: [PARCELS_LAYER],
      },
    });

    expect(grouped.ok).toBe(true);
    expect(grouped.output.dissolveSummary).toEqual({
      inputLayerId: 'parcels',
      dissolveField: 'zone',
      inputFeatureCount: 3,
      outputGroupCount: 2,
    });

    const outLayer = grouped.state.layers.find((l) => l.id === grouped.state.added[0].id);
    expect(outLayer.geojson.features).toHaveLength(2);
    expect(outLayer.geojson.features[0].properties).toEqual(
      expect.objectContaining({
        zone: 'Residential',
        dissolvedCount: 2,
        areaSqm: expect.any(Number),
      })
    );
    expect(outLayer.geojson.features[1].properties).toEqual(
      expect.objectContaining({
        zone: 'Commercial',
        dissolvedCount: 1,
        areaSqm: expect.any(Number),
      })
    );
  });

  test('dissolves all polygons into a single boundary when Dissolve Field is empty', async () => {
    const allDissolved = await runHeadlessTool({
      tool: 'DissolveTool',
      params: {
        'Input Layer': 'parcels',
        'Dissolve Field': '',
      },
      state: {
        layers: [PARCELS_LAYER],
      },
    });

    expect(allDissolved.ok).toBe(true);
    expect(allDissolved.output.dissolveSummary).toEqual({
      inputLayerId: 'parcels',
      dissolveField: null,
      inputFeatureCount: 3,
      outputGroupCount: 1,
    });

    const outLayer = allDissolved.state.layers.find((l) => l.id === allDissolved.state.added[0].id);
    expect(outLayer.geojson.features).toHaveLength(1);
    expect(outLayer.geojson.features[0].properties.dissolvedCount).toBe(3);
  });
});
