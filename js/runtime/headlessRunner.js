const { normalizeHeadlessState } = require('./headlessState');
const { getToolByKey } = require('./toolRegistry');
const { validateExecutionSpec } = require('./executionSpec');

async function runToolHeadlessly({ toolKey, params, state, spatial = null }) {
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
    spatial,
  };
  const toolParams = params || {};
  const executionValidation = validateExecutionSpec(tool.getSpec(), toolParams, normalizedState);
  const toolValidation = await tool.validate(toolParams, context);
  const validation = { ok: executionValidation.ok && toolValidation.ok, errors: [...executionValidation.errors, ...toolValidation.errors] };
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
