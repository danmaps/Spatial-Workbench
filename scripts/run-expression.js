#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHeadlessApiRuntimeManager, requestJson } = require('../js/headless-api-client');
const { runExpression } = require('../js/runtime/spatialExpression');

async function main() {
  const expressionPath = process.argv[2];
  if (!expressionPath) throw new Error('Usage: node scripts/run-expression.js <expression.json>');
  const expression = JSON.parse(fs.readFileSync(path.resolve(expressionPath), 'utf8'));
  const runtimeManager = createHeadlessApiRuntimeManager();
  let runtime;
  try {
    runtime = await runtimeManager.getRuntime();
    const discovery = await requestJson(runtime.baseUrl, '/api/run');
    if (!discovery.ok || !discovery.data?.ok) throw new Error(discovery.data?.error || 'Tool discovery failed.');
    const advertised = new Set((discovery.data.supportedTools || []).map((tool) => tool.key));
    expression.steps.forEach((step) => {
      if (!advertised.has(step.tool)) throw new Error(`Expression step ${step.id} uses unavailable tool: ${step.tool}`);
    });
    // A few browser-oriented tools log progress while executing. Keep the
    // expression receipt clean on stdout so it can be piped to jq or a caller.
    const originalLog = console.log;
    console.log = (...args) => console.error(...args);
    let replay;
    try {
      replay = await runExpression(expression, async ({ tool, params, state }) => {
        const response = await requestJson(runtime.baseUrl, '/api/run', { method: 'POST', body: { tool, params, state } });
        return response.data || { ok: false, error: `HTTP ${response.status}` };
      });
    } finally {
      console.log = originalLog;
    }
    console.log(JSON.stringify(replay, null, 2));
    if (!replay.ok) process.exitCode = 1;
  } finally {
    if (runtime && !process.env.HEADLESS_API_URL) await runtimeManager.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
