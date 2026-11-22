const { filterCompatibleLayers, getInputLayerIds, validateExecutionSpec } = require('./executionSpec');

const layerSpec = {
  execution: {
    inputs: [
      { parameter: 'Source', kind: 'layer', geometryTypes: ['Point'], cardinality: 'one' },
      { parameter: 'Boundary', kind: 'layer', geometryTypes: ['Polygon'], cardinality: 'one' },
    ],
  },
};

describe('execution spec helpers', () => {
  test('collects declared multi-layer inputs without relying on parameter names', () => {
    expect(getInputLayerIds(layerSpec, { Source: 'points', Boundary: 'boundary' })).toEqual(['points', 'boundary']);
  });

  test('rejects incompatible declared layer geometry before execution', () => {
    expect(validateExecutionSpec(layerSpec, { Source: 'polygons', Boundary: 'boundary' }, {
      layers: [
        { id: 'polygons', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] } },
        { id: 'boundary', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } } },
      ],
    })).toEqual({
      ok: false,
      errors: ['Source only accepts Point geometry; received Polygon.'],
    });
  });

  test('validates feature-collection mutation targets against declared geometry', () => {
    const spec = {
      execution: {
        inputs: [{ kind: 'featureCollection', geometryTypes: ['Point'], selectionAware: true }],
      },
    };
    expect(validateExecutionSpec(spec, {}, {
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { __id: 'line' }, geometry: { type: 'LineString', coordinates: [] } },
        ],
      },
      selection: { featureIds: ['line'] },
    })).toEqual({
      ok: false,
      errors: ['Feature collection only accepts Point geometry; received LineString.'],
    });
  });

  test('filterCompatibleLayers classifies layers against declared geometry constraints', () => {
    const candidates = filterCompatibleLayers([
      {
        id: 'points-1',
        name: 'Survey Points',
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }],
        },
      },
      {
        id: 'parcels-1',
        name: 'Study Parcels',
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] } },
            { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]] } },
          ],
        },
      },
    ], {
      parameter: 'Clip Layer',
      kind: 'layer',
      geometryTypes: ['Polygon', 'MultiPolygon'],
    });

    expect(candidates).toEqual([
      {
        id: 'points-1',
        displayName: 'Survey Points',
        geometryTypes: ['Point'],
        primaryGeometryType: 'Point',
        featureCount: 1,
        compatible: false,
        incompatibleTypes: ['Point'],
        reason: 'Clip Layer only accepts Polygon, MultiPolygon geometry; received Point.',
      },
      {
        id: 'parcels-1',
        displayName: 'Study Parcels',
        geometryTypes: ['Polygon'],
        primaryGeometryType: 'Polygon',
        featureCount: 2,
        compatible: true,
        incompatibleTypes: [],
        reason: null,
      },
    ]);
  });
});
