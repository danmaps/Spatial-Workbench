const { normalizeHeadlessState } = require('./headlessState');
const { getToolByKey } = require('./toolRegistry');

async function runToolHeadlessly({ toolKey, params, state }) {
  const tool = getToolByKey(toolKey);
  if (!tool) {
    const error = new Error(`Unknown tool: ${toolKey}`);
    error.statusCode = 404;
    throw error;
  }

  if (!tool.headlessSupported) {
    const error = new Error(`Tool does not support headless execution: ${toolKey}`);
    error.statusCode = 400;
    throw error;
  }

  const normalizedState = normalizeHeadlessState(state);
  const context = {
    headless: true,
    state: normalizedState,
    tool,
  };
  const toolParams = params || {};
  const validation = await tool.validate(toolParams, context);
  if (!validation.ok) {
    const message = validation.errors[0] || 'Invalid tool parameters.';
    tool.setStatus(2, message);
    return {
      ok: false,
      tool: tool.getSpec().key,
      status: tool.getStatus(),
      validation,
      output: null,
      state: normalizedState,
    };
  }

  const result = await tool.run(toolParams, context);
  const { state: resultState, ...output } = result || {};
  const status = tool.getStatus();

  return {
    ok: status.code === 0,
    tool: tool.getSpec().key,
    status,
    output: result ? output : null,
    state: resultState || normalizedState,
  };
}

module.exports = {
  runToolHeadlessly,
};
