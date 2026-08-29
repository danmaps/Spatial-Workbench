const { intersectPolygons, unionPolygons } = require('./overlay');

const first = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } };
const second = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } };

describe('overlay Turf API compatibility', () => {
  test('falls back to Turf 7 FeatureCollection signatures', () => {
    const turf7 = {
      featureCollection: (features) => ({ type: 'FeatureCollection', features }),
      union(value, secondValue) {
        if (secondValue) throw new Error('Turf 7 expects a collection');
        return { operation: 'union', input: value };
      },
      intersect(value, secondValue) {
        if (secondValue) throw new Error('Turf 7 expects a collection');
        return { operation: 'intersect', input: value };
      },
    };

    expect(unionPolygons(first, second, turf7)).toEqual(expect.objectContaining({ operation: 'union' }));
    expect(intersectPolygons(first, second, turf7)).toEqual(expect.objectContaining({ operation: 'intersect' }));
  });
});
