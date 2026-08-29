const { runHeadlessTool } = require('../headless-runtime');

const square = (min, max) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]] } });
const squareWithId = (min, max, id) => ({ type: 'Feature', properties: { __id: id }, geometry: { type: 'Polygon', coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]] } });

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

describe('Clip and Erase tools — selection-aware targeting', () => {
  const twoFeatureState = {
    layers: [
      {
        id: 'input',
        geojson: {
          type: 'FeatureCollection',
          features: [
            squareWithId(0, 10, 'poly-a'),
            squareWithId(3, 12, 'poly-b'),
          ],
        },
      },
      { id: 'mask', geojson: { type: 'FeatureCollection', features: [square(5, 15)] } },
    ],
  };

  test('ClipTool clips only the selected input feature', async () => {
    const result = await runHeadlessTool({
      tool: 'ClipTool',
      params: { 'Input Layer': 'input', 'Clip Layer': 'mask' },
      state: {
        ...twoFeatureState,
        selection: {
          activeLayerId: 'input',
          selectedLayerIds: ['input'],
          selectedFeaturesByLayerId: { input: ['poly-a'] },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ clippedCount: 1 }));
    expect(result.state.added).toHaveLength(1);
    expect(result.state.added[0].geojson).toEqual(expect.objectContaining({
      toolMetadata: expect.objectContaining({
        target: expect.objectContaining({
          mode: 'selection',
          selectedFeatureIds: ['poly-a'],
          selectedFeatureCount: 1,
          totalFeatureCount: 2,
        }),
      }),
    }));
  });

  test('ClipTool falls back to the whole layer when no relevant selection exists', async () => {
    const result = await runHeadlessTool({
      tool: 'ClipTool',
      params: { 'Input Layer': 'input', 'Clip Layer': 'mask' },
      state: {
        ...twoFeatureState,
        selection: {
          activeLayerId: 'other-layer',
          selectedLayerIds: ['other-layer'],
          selectedFeaturesByLayerId: {},
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ clippedCount: 2 }));
    expect(result.state.added).toHaveLength(1);
    expect(result.state.added[0].geojson).toEqual(expect.objectContaining({
      toolMetadata: expect.objectContaining({
        target: expect.objectContaining({ mode: 'layer', selectedFeatureCount: 0, totalFeatureCount: 2 }),
      }),
    }));
  });

  test('EraseTool erases only from the selected input feature', async () => {
    const result = await runHeadlessTool({
      tool: 'EraseTool',
      params: { 'Input Layer': 'input', 'Erase Layer': 'mask' },
      state: {
        ...twoFeatureState,
        selection: {
          activeLayerId: 'input',
          selectedLayerIds: ['input'],
          selectedFeaturesByLayerId: { input: ['poly-b'] },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ erasedCount: 1 }));
    expect(result.state.added).toHaveLength(1);
    expect(result.state.added[0].geojson).toEqual(expect.objectContaining({
      toolMetadata: expect.objectContaining({
        target: expect.objectContaining({
          mode: 'selection',
          selectedFeatureIds: ['poly-b'],
          selectedFeatureCount: 1,
          totalFeatureCount: 2,
        }),
      }),
    }));
  });

  test('EraseTool falls back to the whole layer when no relevant selection exists', async () => {
    const result = await runHeadlessTool({
      tool: 'EraseTool',
      params: { 'Input Layer': 'input', 'Erase Layer': 'mask' },
      state: {
        ...twoFeatureState,
        selection: {
          activeLayerId: 'other-layer',
          selectedLayerIds: ['other-layer'],
          selectedFeaturesByLayerId: {},
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ erasedCount: 2 }));
    expect(result.state.added).toHaveLength(1);
    expect(result.state.added[0].geojson).toEqual(expect.objectContaining({
      toolMetadata: expect.objectContaining({
        target: expect.objectContaining({ mode: 'layer', selectedFeatureCount: 0, totalFeatureCount: 2 }),
      }),
    }));
  });
});
