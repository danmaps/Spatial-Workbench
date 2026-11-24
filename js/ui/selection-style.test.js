const {
  getComparisonFeatureStyle,
  getComparisonSummaryMeta,
  getFeatureSymbologyStyle,
  getGroupColor,
  getGroupFeatureStyle,
  getGroupSummaryMeta,
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

  test('returns distinct comparison styles for intersection, only-in-a, and only-in-b features', () => {
    expect(getComparisonFeatureStyle({ properties: { comparisonRole: 'intersection' } })).toEqual({
      color: '#38bdf8',
      fillColor: '#38bdf8',
      fillOpacity: 0.35,
      weight: 2.5,
      opacity: 0.95,
    });

    expect(getComparisonFeatureStyle({ properties: { comparisonRole: 'only-in-a' } })).toEqual({
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.28,
      weight: 2,
      opacity: 0.9,
      dashArray: '5 4',
    });

    expect(getComparisonFeatureStyle({ properties: { comparisonRole: 'only-in-b' } })).toEqual({
      color: '#ec4899',
      fillColor: '#ec4899',
      fillOpacity: 0.28,
      weight: 2,
      opacity: 0.9,
      dashArray: '2 4',
    });

    expect(getComparisonFeatureStyle({ properties: { name: 'plain' } })).toBeNull();
  });

  test('builds comparison summary metadata and visual diff legend items', () => {
    const summary = getComparisonSummaryMeta({
      layerAId: 'parcel-a',
      layerBId: 'parcel-b',
      areaASqm: 1000,
      areaBSqm: 1250,
      intersectionAreaSqm: 800,
      onlyInAAreaSqm: 200,
      onlyInBAreaSqm: 450,
      areaDeltaSqm: 250,
      jaccardSimilarity: 0.5517,
      componentCounts: { intersection: 1, onlyInA: 1, onlyInB: 1 },
    });

    expect(summary).toEqual(
      expect.objectContaining({
        layerAId: 'parcel-a',
        layerBId: 'parcel-b',
        overlapBadgeText: '55.2% overlap',
        deltaBadgeText: 'Δ +250 m²',
      })
    );
    expect(summary.legendItems).toHaveLength(3);
    expect(summary.legendItems.map((item) => ({
      role: item.role,
      shortLabel: item.shortLabel,
      color: item.color,
      present: item.present,
      areaSqm: item.areaSqm,
    }))).toEqual([
      { role: 'intersection', shortLabel: 'A ∩ B', color: '#38bdf8', present: true, areaSqm: 800 },
      { role: 'only-in-a', shortLabel: 'A - B', color: '#f59e0b', present: true, areaSqm: 200 },
      { role: 'only-in-b', shortLabel: 'B - A', color: '#ec4899', present: true, areaSqm: 450 },
    ]);
  });

  test('assigns distinct deterministic colors and styles by groupId (including ungrouped features)', () => {
    expect(getGroupColor('group-1')).toBe('#38bdf8');
    expect(getGroupColor('group-2')).toBe('#f59e0b');
    expect(getGroupColor('group-3')).toBe('#ec4899');
    expect(getGroupColor(null)).toBe('#94a3b8');

    const pointStyle = getGroupFeatureStyle({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { groupId: 'group-2', groupSize: 3 },
    });
    expect(pointStyle).toEqual(
      expect.objectContaining({
        fillColor: '#f59e0b',
        radius: 7.5,
        fillOpacity: 0.9,
      })
    );

    const ungroupedPointStyle = getGroupFeatureStyle({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 1] },
      properties: { groupId: null, groupSize: 1 },
    });
    expect(ungroupedPointStyle).toEqual(
      expect.objectContaining({
        fillColor: '#94a3b8',
        radius: 5.5,
      })
    );

    expect(getFeatureSymbologyStyle({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: { groupId: 'group-1' },
    })).toEqual(expect.objectContaining({ color: '#38bdf8', fillColor: '#38bdf8' }));

    const summary = getGroupSummaryMeta({
      groupCount: 2,
      ungroupedCount: 1,
      groups: [
        { groupId: 'group-1', featureCount: 3 },
        { groupId: 'group-2', featureCount: 2 },
      ],
    });
    expect(summary.badgeText).toBe('2 groups');
    expect(summary.legendItems).toEqual([
      { groupId: 'group-1', label: 'group-1', color: '#38bdf8', featureCount: 3 },
      { groupId: 'group-2', label: 'group-2', color: '#f59e0b', featureCount: 2 },
      { groupId: '__ungrouped__', label: 'Ungrouped', color: '#94a3b8', featureCount: 1 },
    ]);
  });
});
