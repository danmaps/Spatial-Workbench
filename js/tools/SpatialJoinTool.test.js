const turf = require('@turf/turf');
const { runHeadlessTool } = require('../headless-runtime');

global.turf = turf;

const ZONES_POLYGON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { __id: 'zone-north', zone_name: 'North District', budget: 200 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.26, 34.05],
            [-118.23, 34.05],
            [-118.23, 34.07],
            [-118.26, 34.07],
            [-118.26, 34.05],
          ],
        ],
      },
    },
  ],
};

const SENSORS_POINTS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { __id: 'sensor-1', name: 'Sensor A', reading: 10 },
      geometry: { type: 'Point', coordinates: [-118.245, 34.06] },
    },
    {
      type: 'Feature',
      properties: { __id: 'sensor-2', name: 'Sensor B', reading: 30 },
      geometry: { type: 'Point', coordinates: [-118.24, 34.055] },
    },
    {
      type: 'Feature',
      properties: { __id: 'sensor-3', name: 'Sensor Outside', reading: 90 },
      geometry: { type: 'Point', coordinates: [-118.245, 34.048] },
    },
  ],
};

describe('SpatialJoinTool (#165)', () => {
  test('transfers polygon attributes onto points using within predicate in first_match mode', async () => {
    const result = await runHeadlessTool({
      tool: 'SpatialJoinTool',
      params: {
        'Target Layer': 'sensors',
        'Join Layer': 'zones',
        Predicate: 'within',
        'Join Mode': 'first_match',
      },
      state: {
        layers: [
          { id: 'sensors', name: 'Sensors', geojson: SENSORS_POINTS },
          { id: 'zones', name: 'Zones', geojson: ZONES_POLYGON },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.joinSummary).toEqual(
      expect.objectContaining({
        targetLayerId: 'sensors',
        joinLayerId: 'zones',
        predicate: 'within',
        joinMode: 'first_match',
        matchedTargetCount: 2,
        unmatchedTargetCount: 1,
      })
    );

    const addedLayer = result.state.layers.find((l) => l.id === result.state.added[0].id);
    expect(addedLayer.geojson.features[0].properties).toEqual(
      expect.objectContaining({
        name: 'Sensor A',
        join_count: 1,
        join_matched: true,
        zone_name: 'North District',
        budget: 200,
      })
    );
    expect(addedLayer.geojson.features[2].properties).toEqual(
      expect.objectContaining({
        name: 'Sensor Outside',
        join_count: 0,
        join_matched: false,
      })
    );
  });

  test('aggregates numeric attributes onto polygons in summary mode and supports within_distance', async () => {
    const summaryResult = await runHeadlessTool({
      tool: 'SpatialJoinTool',
      params: {
        'Target Layer': 'zones',
        'Join Layer': 'sensors',
        Predicate: 'intersects',
        'Join Mode': 'summary',
      },
      state: {
        layers: [
          { id: 'zones', name: 'Zones', geojson: ZONES_POLYGON },
          { id: 'sensors', name: 'Sensors', geojson: SENSORS_POINTS },
        ],
      },
    });

    expect(summaryResult.ok).toBe(true);
    const summaryLayer = summaryResult.state.layers.find((l) => l.id === summaryResult.state.added[0].id);
    expect(summaryLayer.geojson.features[0].properties).toEqual(
      expect.objectContaining({
        zone_name: 'North District',
        join_count: 2,
        join_matched: true,
        join_reading_sum: 40,
        join_reading_mean: 20,
      })
    );

    // within_distance (300 meters) matches sensor-3 just outside the south boundary (34.048 vs 34.05)
    const withinDistanceResult = await runHeadlessTool({
      tool: 'SpatialJoinTool',
      params: {
        'Target Layer': 'sensors',
        'Join Layer': 'zones',
        Predicate: 'within_distance',
        Distance: 300,
        Units: 'meters',
        'Join Mode': 'first_match',
      },
      state: {
        layers: [
          { id: 'sensors', name: 'Sensors', geojson: SENSORS_POINTS },
          { id: 'zones', name: 'Zones', geojson: ZONES_POLYGON },
        ],
      },
    });

    expect(withinDistanceResult.ok).toBe(true);
    expect(withinDistanceResult.output.joinSummary.matchedTargetCount).toBe(3);
  });
});
