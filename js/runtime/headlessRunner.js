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
  const result = await tool.run(params || {}, {
    headless: true,
    state: normalizedState,
    tool,
  });

  return {
    tool: tool.getSpec().key,
    result,
    status: tool.getStatus(),
  };
}

module.exports = {
  runToolHeadlessly,
};
