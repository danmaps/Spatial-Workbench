/** @jest-environment node */

const {
  createExpressionFromToolHistory,
  replayToolHistory,
  resolveValue,
  runExpression,
  validateExpression,
} = require('./spatialExpression');
const { runHeadlessTool } = require('../headless-runtime');

const expression = {
  version: 1,
  state: { seed: true },
  steps: [
    { id: 'first', tool: 'FirstTool', params: { value: 3 } },
    { id: 'second', tool: 'SecondTool', params: { input: { $ref: 'first.state.added[0].id' } } },
  ],
};

describe('serialized spatial expressions', () => {
  test('resolves nested prior-step references', () => {
    expect(resolveValue({ input: { $ref: 'first.state.added[0].id' } }, {
      first: { state: { added: [{ id: 'layer-1' }] } },
    })).toEqual({ input: 'layer-1' });
  });

  test('replays sequentially and propagates state', async () => {
    const calls = [];
    const result = await runExpression(expression, async ({ tool, params, state }) => {
      calls.push({ tool, params, state });
      return { ok: true, state: { ...state, added: [{ id: tool }] } };
    });
    expect(result.ok).toBe(true);
    expect(calls[1].params.input).toBe('FirstTool');
    expect(calls[1].state.added[0].id).toBe('FirstTool');
    expect(result.steps).toHaveLength(2);
  });

  test('rejects forward references and duplicate ids', () => {
    expect(() => resolveValue({ $ref: 'later.state' }, {})).toThrow(/Unknown or forward/);
    expect(() => validateExpression({ ...expression, steps: [...expression.steps, { ...expression.steps[0] }] })).toThrow(/Duplicate/);
  });

  test('stops after the first failed step', async () => {
    const calls = [];
    const result = await runExpression(expression, async ({ tool }) => {
      calls.push(tool);
      return { ok: tool !== 'FirstTool', error: 'failed' };
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('first');
    expect(calls).toEqual(['FirstTool']);
  });

  test('bridges layer toolHistory into a chained swb.spatial-expression.v1 recipe and replays on a new target layer (#168)', async () => {
    const initialState = {
      layers: [
        {
          id: 'sites-a',
          name: 'Sites A',
          geojson: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'a-1',
                properties: { __id: 'a-1', zone: 'north' },
                geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
              },
              {
                type: 'Feature',
                id: 'a-2',
                properties: { __id: 'a-2', zone: 'north' },
                geometry: { type: 'Point', coordinates: [-122.4184, 37.7749] },
              },
            ],
          },
        },
        {
          id: 'sites-b',
          name: 'Sites B',
          geojson: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'b-1',
                properties: { __id: 'b-1', zone: 'south' },
                geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
              },
              {
                type: 'Feature',
                id: 'b-2',
                properties: { __id: 'b-2', zone: 'south' },
                geometry: { type: 'Point', coordinates: [-118.2427, 34.0522] },
              },
            ],
          },
        },
      ],
    };

    const step1 = await runHeadlessTool({
      tool: 'BufferTool',
      params: { 'Input Layer': 'sites-a', Distance: 250, Units: 'meters' },
      state: initialState,
    });
    expect(step1.ok).toBe(true);
    const bufferedLayerId = step1.added[0];

    const step2 = await runHeadlessTool({
      tool: 'DissolveTool',
      params: { 'Input Layer': bufferedLayerId, 'Dissolve Field': 'zone' },
      state: step1.state,
    });
    expect(step2.ok).toBe(true);
    const dissolvedLayer = step2.state.added[0];
    const recordedHistory = [
      { name: 'Draw', timestamp: '2026-11-23T00:00:00.000Z', geometryType: 'marker' },
      ...(dissolvedLayer.geojson.toolHistory || []),
    ];

    const recipe = createExpressionFromToolHistory(recordedHistory, {
      targetLayerId: 'sites-b',
      state: initialState,
    });

    expect(recipe.schema).toBe('swb.spatial-expression.v1');
    expect(recipe.version).toBe(1);
    expect(recipe.steps).toEqual([
      {
        id: 'step_1',
        tool: 'BufferTool',
        params: {
          'Input Layer': 'sites-b',
          Distance: 250,
          Units: 'meters',
        },
      },
      {
        id: 'step_2',
        tool: 'DissolveTool',
        params: {
          'Input Layer': { $ref: 'step_1.state.added[0].id' },
          'Dissolve Field': 'zone',
        },
      },
    ]);

    const replay = await replayToolHistory({
      toolHistory: recordedHistory,
      targetLayerId: 'sites-b',
      state: initialState,
      execute: ({ tool, params, state }) => runHeadlessTool({ tool, params, state }),
    });

    expect(replay.ok).toBe(true);
    expect(replay.steps).toHaveLength(2);
    const finalAdded = replay.state.added[0];
    expect(finalAdded.geojson.features).toHaveLength(1);
    expect(finalAdded.geojson.features[0].properties.zone).toBe('south');
    expect(finalAdded.geojson.features[0].properties.dissolvedCount).toBe(2);
  });
});
