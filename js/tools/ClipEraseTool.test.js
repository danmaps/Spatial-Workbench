const { runHeadlessTool } = require('../headless-runtime');

const square = (min, max) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]] } });

describe('Clip and Erase tools', () => {
  const state = {
    layers: [
      { id: 'input', geojson: { type: 'FeatureCollection', features: [square(0, 10)] } },
      { id: 'mask', geojson: { type: 'FeatureCollection', features: [square(5, 15)] } },
    ],
  };

  test('clips input polygons by the overlay layer', async () => {
    const result = await runHeadlessTool({ tool: 'ClipTool', params: { 'Input Layer': 'input', 'Clip Layer': 'mask' }, state });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ clippedCount: 1 }));
    expect(result.state.added).toHaveLength(1);
  });

  test('erases the overlay area from input polygons', async () => {
    const result = await runHeadlessTool({ tool: 'EraseTool', params: { 'Input Layer': 'input', 'Erase Layer': 'mask' }, state });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ erasedCount: 1 }));
    expect(result.state.added).toHaveLength(1);
  });
});
