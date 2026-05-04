const { normalizeToFeatures, stringifyValue, getAttributeModel } = require('./attribute-view');

describe('attribute view helpers', () => {
  test('normalizeToFeatures returns features for feature collections and single features', () => {
    expect(normalizeToFeatures({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { a: 1 }, geometry: null }],
    })).toHaveLength(1);

    expect(normalizeToFeatures({
      type: 'Feature',
      properties: { a: 1 },
      geometry: null,
    })).toHaveLength(1);

    expect(normalizeToFeatures({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });

  test('stringifyValue formats common property types safely', () => {
    expect(stringifyValue(null)).toBe('—');
    expect(stringifyValue(true)).toBe('True');
    expect(stringifyValue([1, 2, 3])).toBe('1, 2, 3');
    expect(stringifyValue({ status: 'ok' })).toBe('{"status":"ok"}');
  });

  test('getAttributeModel builds ordered columns and rows for attribute rendering', () => {
    const model = getAttributeModel({
      id: 'layer-1',
      geometry: { label: 'Point', type: 'Point' },
      geojson: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { name: 'Alpha', value: 5, category: 'A' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { value: 8, active: true },
          },
        ],
      },
    });

    expect(model.columns).toEqual(['name', 'active', 'category', 'value']);
    expect(model.totalRows).toBe(2);
    expect(model.rows[0]).toEqual(expect.objectContaining({
      title: 'Alpha',
      geometryType: 'Point',
    }));
    expect(model.rows[1].cells.find((cell) => cell.key === 'active').value).toBe('True');
  });

  test('getAttributeModel respects row limits and flags overflow', () => {
    const features = Array.from({ length: 3 }, (_, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [index, index] },
      properties: { value: index },
    }));

    const model = getAttributeModel({
      id: 'layer-2',
      geometry: { label: 'Point' },
      geojson: { type: 'FeatureCollection', features },
    }, { maxRows: 2 });

    expect(model.visibleRows).toBe(2);
    expect(model.totalRows).toBe(3);
    expect(model.hasMoreRows).toBe(true);
  });
});
