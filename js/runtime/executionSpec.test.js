const { getInputLayerIds, validateExecutionSpec } = require('./executionSpec');

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
});
