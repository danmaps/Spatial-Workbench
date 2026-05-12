const {
  getLayerSelectionVisualState,
  getFeatureHighlightStyle,
  getLayerSelectionFeatureIds,
} = require('./selection-style');

describe('selection styling helpers', () => {
  test('marks active layers distinctly from selected layers', () => {
    expect(getLayerSelectionVisualState({ isSelected: true, isActive: true })).toEqual({
      tone: 'active',
      tocClasses: ['is-selected', 'is-active'],
      label: 'Active',
    });

    expect(getLayerSelectionVisualState({ isSelected: true, isActive: false })).toEqual({
      tone: 'selected',
      tocClasses: ['is-selected'],
      label: 'Selected',
    });
  });

  test('returns calm highlight styles for points, lines, and polygons', () => {
    expect(getFeatureHighlightStyle({ geometryType: 'Point', isActive: true })).toEqual(
      expect.objectContaining({ kind: 'point', radius: 12, weight: 3, color: '#7dd3fc' })
    );

    expect(getFeatureHighlightStyle({ geometryType: 'LineString', isActive: false })).toEqual(
      expect.objectContaining({ kind: 'line', weight: 6, color: '#4fb3ff' })
    );

    expect(getFeatureHighlightStyle({ geometryType: 'Polygon', isActive: false })).toEqual(
      expect.objectContaining({ kind: 'area', dashArray: '4 4', fillOpacity: 0.14 })
    );
  });

  test('summarizes selected feature counts defensively', () => {
    expect(getLayerSelectionFeatureIds({ featureIds: ['a', 'b', null], totalFeatureCount: 5 })).toEqual({
      count: 2,
      total: 5,
      summary: '2 selected',
    });

    expect(getLayerSelectionFeatureIds({ featureIds: [], totalFeatureCount: -3 })).toEqual({
      count: 0,
      total: 0,
      summary: '',
    });
  });
});
