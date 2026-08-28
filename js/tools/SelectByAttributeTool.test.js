const { matchesAttribute, applyMode } = require('./SelectByAttributeTool');

describe('SelectByAttributeTool helpers', () => {
  test('matches text and numeric predicates', () => {
    expect(matchesAttribute('Downtown', 'contains', 'town')).toBe(true);
    expect(matchesAttribute('12', 'greater than', '10')).toBe(true);
    expect(matchesAttribute('', 'is empty', '')).toBe(true);
  });

  test('applies replace, add, and remove selection modes', () => {
    expect(applyMode(['a', 'b'], ['b', 'c'], 'replace')).toEqual(['b', 'c']);
    expect(applyMode(['a'], ['b'], 'add')).toEqual(['a', 'b']);
    expect(applyMode(['a', 'b'], ['b'], 'remove')).toEqual(['a']);
  });

  test('selects matching features through the headless runtime', async () => {
    const { runHeadlessTool } = require('../headless-runtime');
    const result = await runHeadlessTool({
      tool: 'SelectByAttributeTool',
      params: { Layer: 'places', Field: 'type', Operator: 'equals', Value: 'park', 'Selection Mode': 'replace' },
      state: {
        layers: [{ id: 'places', geojson: { type: 'FeatureCollection', features: [
          { type: 'Feature', properties: { type: 'park' }, geometry: { type: 'Point', coordinates: [0, 0] } },
          { type: 'Feature', properties: { type: 'school' }, geometry: { type: 'Point', coordinates: [1, 1] } },
        ] } }],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ selectedCount: 1, matchedCount: 1 }));
    expect(result.state.selection.selectedFeaturesByLayerId.places).toEqual(['places-1']);
  });
});
