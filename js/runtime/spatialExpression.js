const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MAX_BYTES = 256 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expressionError(message, details = {}) {
  const error = new Error(message);
  error.code = 'INVALID_EXPRESSION';
  Object.assign(error, details);
  return error;
}

function parsePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw expressionError('Expression reference path must be a non-empty string.');
  }
  const tokens = [];
  path.split('.').forEach((part) => {
    const match = /^([^[]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) throw expressionError(`Invalid expression reference path: ${path}`);
    tokens.push(match[1]);
    (match[2].match(/\d+/g) || []).forEach((index) => tokens.push(Number(index)));
  });
  return tokens;
}

function resolveReference(reference, receipts, currentStepIndex) {
  if (!isPlainObject(reference) || Object.keys(reference).length !== 1 || typeof reference.$ref !== 'string') {
    throw expressionError('A $ref value must be an object containing only a string $ref property.');
  }
  const separator = reference.$ref.indexOf('.');
  const stepId = separator === -1 ? reference.$ref : reference.$ref.slice(0, separator);
  const path = separator === -1 ? '' : reference.$ref.slice(separator + 1);
  const receipt = receipts[stepId];
  if (!receipt) {
    const known = Object.keys(receipts);
    const reason = currentStepIndex !== undefined && known.length === 0
      ? 'References cannot target a step before it has completed.'
      : `Unknown or forward step reference: ${stepId}`;
    throw expressionError(reason, { reference: reference.$ref });
  }
  if (!path) return receipt;
  let value = receipt;
  for (const token of parsePath(path)) {
    if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), token)) {
      throw expressionError(`Reference does not resolve: ${reference.$ref}`, { reference: reference.$ref });
    }
    value = value[token];
  }
  if (value === undefined) throw expressionError(`Reference does not resolve: ${reference.$ref}`, { reference: reference.$ref });
  return value;
}

function resolveValue(value, receipts, currentStepIndex) {
  if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, '$ref')) return resolveReference(value, receipts, currentStepIndex);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveValue(child, receipts, currentStepIndex)]));
  }
  if (Array.isArray(value)) return value.map((child) => resolveValue(child, receipts, currentStepIndex));
  return value;
}

function validateExpression(expression, options = {}) {
  const maxSteps = options.maxSteps || DEFAULT_MAX_STEPS;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  if (!isPlainObject(expression)) throw expressionError('Expression must be a JSON object.');
  if (expression.version !== 1) throw expressionError('Expression version must be 1.');
  if (!isPlainObject(expression.state)) throw expressionError('Expression state must be a JSON object.');
  if (!Array.isArray(expression.steps) || expression.steps.length === 0) throw expressionError('Expression steps must be a non-empty array.');
  if (expression.steps.length > maxSteps) throw expressionError(`Expression exceeds the maximum of ${maxSteps} steps.`);
  const serialized = JSON.stringify(expression);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw expressionError(`Expression exceeds the maximum size of ${maxBytes} bytes.`);

  const ids = new Set();
  expression.steps.forEach((step, index) => {
    if (!isPlainObject(step)) throw expressionError(`Step ${index + 1} must be an object.`);
    if (typeof step.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(step.id)) throw expressionError(`Step ${index + 1} has an invalid id.`);
    if (ids.has(step.id)) throw expressionError(`Duplicate expression step id: ${step.id}`);
    ids.add(step.id);
    if (typeof step.tool !== 'string' || !step.tool) throw expressionError(`Step ${step.id} must name a tool.`);
    if (step.params !== undefined && !isPlainObject(step.params)) throw expressionError(`Step ${step.id} params must be an object.`);
  });

  return { ok: true, stepCount: expression.steps.length, maxSteps, maxBytes };
}

async function runExpression(expression, execute, options = {}) {
  validateExpression(expression, options);
  let state = expression.state;
  const receipts = {};
  const steps = [];
  for (let index = 0; index < expression.steps.length; index += 1) {
    const step = expression.steps[index];
    const params = resolveValue(step.params || {}, receipts, index);
    const response = await execute({ tool: step.tool, params, state, step, index });
    const receipt = response && typeof response === 'object' ? response : { output: response };
    receipts[step.id] = receipt;
    steps.push({ id: step.id, tool: step.tool, ok: receipt.ok !== false, response: receipt });
    if (receipt.ok === false) {
      return { ok: false, version: expression.version, steps, receipts, state: receipt.state || state, failedStep: step.id };
    }
    state = receipt.state || state;
  }
  return { ok: true, version: expression.version, steps, receipts, state };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_STEPS,
  resolveReference,
  resolveValue,
  runExpression,
  validateExpression,
};
