const { resolveTargetLayerData } = require('./targeting');

describe('resolveTargetLayerData', () => {
  test('uses selected features when they belong to the target layer', () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
      ],
    };

    const result = resolveTargetLayerData('input-1', {
      getLayer: () => ({
        toGeoJSON: () => sourceGeoJSON,
      }),
      state: {
        selection: {
          activeLayerId: 'input-1',
          selectedLayerIds: ['input-1'],
          selectedFeaturesByLayerId: { 'input-1': ['feature-2'] },
        },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      mode: 'selection',
      selectedFeatureIds: ['feature-2'],
      selectedFeatureCount: 1,
      totalFeatureCount: 2,
      targetGeoJSON: {
        type: 'FeatureCollection',
        features: [
          expect.objectContaining({ properties: expect.objectContaining({ __id: 'feature-2' }) }),
        ],
      },
    }));
  });

  test('falls back to the whole layer when selection state does not match any features in the target layer', () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
      ],
    };

    const result = resolveTargetLayerData('input-1', {
      getLayer: () => ({
        toGeoJSON: () => sourceGeoJSON,
      }),
      state: {
        selection: {
          activeLayerId: 'other-layer',
          selectedLayerIds: ['other-layer'],
          selectedFeaturesByLayerId: { 'input-1': ['missing-feature-id'] },
        },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      mode: 'layer',
      selectedFeatureIds: [],
      selectedFeatureCount: 0,
      totalFeatureCount: 2,
      targetGeoJSON: sourceGeoJSON,
    }));
  });
});
