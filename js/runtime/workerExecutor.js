/**
 * Terminable execution boundary for headless tool runs.
 *
 * Tool execution happens in a dedicated worker thread so that a hard deadline
 * can actually be enforced: on timeout the worker is terminated, which stops
 * synchronous CPU-bound geometry work instead of merely rejecting the HTTP
 * request while the work keeps blocking the process.
 *
 * Concurrency is accounted by live worker threads. A slot is taken when the
 * worker is spawned and released exactly once, when the thread has actually
 * exited (success, failure, or termination).
 */

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'executionWorker.js');

let activeWorkers = 0;

function getActiveWorkerCount() {
  return activeWorkers;
}

function createExecutionError(message, { statusCode = 500, code, details, limit } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details) error.details = details;
  if (limit !== undefined) error.limit = limit;
  return error;
}

function reviveWorkerError(serialized) {
  return createExecutionError(serialized?.message || 'Tool execution failed.', {
    statusCode: serialized?.statusCode || 500,
    code: serialized?.code,
    details: serialized?.details,
    limit: serialized?.limit,
  });
}

/**
 * Run a tool inside a worker thread.
 *
 * @returns {Promise<{ result: object, spatialWarnings: Array }>}
 */
function runToolInWorker({
  toolKey,
  params,
  state,
  spatialWarnings = [],
  timeoutMs = 0,
  maxConcurrentRuns = Infinity,
}) {
  if (Number.isFinite(maxConcurrentRuns) && activeWorkers >= maxConcurrentRuns) {
    return Promise.reject(createExecutionError(
      'Server capacity reached. Too many concurrent spatial requests — try again shortly.',
      { statusCode: 503, code: 'CONCURRENCY_LIMIT', limit: maxConcurrentRuns },
    ));
  }

  activeWorkers += 1;
  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    activeWorkers -= 1;
  };

  let worker;
  try {
    worker = new Worker(WORKER_PATH, {
      workerData: { toolKey, params: params || {}, state: state || {}, spatialWarnings },
    });
  } catch (error) {
    releaseSlot();
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const settle = (action, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      action(value);
    };

    const stopWorker = () => {
      worker.terminate().catch(() => { /* already gone */ });
    };

    worker.on('message', (message) => {
      if (message && message.ok) {
        settle(resolve, {
          result: message.result,
          spatialWarnings: Array.isArray(message.spatialWarnings) ? message.spatialWarnings : [],
        });
      } else {
        settle(reject, reviveWorkerError(message && message.error));
      }
      stopWorker();
    });

    worker.on('error', (error) => {
      settle(reject, createExecutionError(error?.message || 'Tool execution failed.', {
        statusCode: error?.statusCode || 500,
        code: error?.code,
      }));
    });

    // 'exit' always fires last — after success, after an 'error' event, and after
    // termination — so it is the single place the concurrency slot is released.
    worker.on('exit', (code) => {
      releaseSlot();
      settle(reject, createExecutionError(`Tool execution worker exited unexpectedly (code ${code}).`, {
        statusCode: 500,
        code: 'EXECUTION_FAILED',
      }));
    });

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        settle(reject, createExecutionError('Tool execution timed out.', {
          statusCode: 503,
          code: 'EXECUTION_TIMEOUT',
          details: { timeoutMs },
        }));
        stopWorker();
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
  });
}

module.exports = {
  runToolInWorker,
  getActiveWorkerCount,
};
