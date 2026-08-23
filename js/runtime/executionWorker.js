/**
 * Worker-thread entry point for headless tool execution.
 *
 * The worker owns a single tool run. Because it has its own event loop and V8
 * isolate, synchronous (CPU-bound) Turf work can be interrupted by terminating
 * the worker — something `Promise.race()` on the main thread cannot do.
 *
 * Input (workerData): { toolKey, params, state, spatialWarnings }
 * Output (postMessage):
 *   { ok: true, result, spatialWarnings }
 *   { ok: false, error: { message, statusCode, code, details, limit } }
 */

const { parentPort, workerData } = require('worker_threads');

const { runHeadlessTool } = require('../headless-runtime');
const { runToolHeadlessly } = require('./headlessRunner');
const { createSpatialSession } = require('../spatial');

async function execute({ toolKey, params, state, spatialWarnings }) {
  const spatial = createSpatialSession(spatialWarnings || []);
  const result = state?.featureCollection
    ? await runToolHeadlessly({ toolKey, params, state, spatial })
    : await runHeadlessTool({ tool: toolKey, params, state, spatial });

  return { result, spatialWarnings: spatial.getWarnings() };
}

execute(workerData || {})
  .then(({ result, spatialWarnings }) => {
    parentPort.postMessage({ ok: true, result, spatialWarnings });
  })
  .catch((error) => {
    parentPort.postMessage({
      ok: false,
      error: {
        message: error?.message || 'Tool execution failed.',
        statusCode: error?.statusCode || 500,
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.details ? { details: error.details } : {}),
        ...(error?.limit !== undefined ? { limit: error.limit } : {}),
      },
    });
  });
