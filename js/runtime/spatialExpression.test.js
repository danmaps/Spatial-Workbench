/** @jest-environment node */

const { resolveValue, runExpression, validateExpression } = require('./spatialExpression');

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
});
