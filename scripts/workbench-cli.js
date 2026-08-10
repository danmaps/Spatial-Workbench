#!/usr/bin/env node
/**
 * Spatial Workbench CLI
 *
 * A thin CLI wrapper over the headless execution API.
 *
 * Usage:
 *   node scripts/workbench-cli.js list
 *   node scripts/workbench-cli.js state
 *   node scripts/workbench-cli.js run --tool <ToolKey> --params <json> [--state <json|file>]
 *
 * Environment:
 *   HEADLESS_API_URL  Point at an already-running server (default: start a local ephemeral one)
 */

'use strict';

const fs = require('fs');
const { createHeadlessApiRuntimeManager, requestJson } = require('../js/headless-api-client');

function printUsage() {
  console.log(`Usage:
  workbench-cli list                              List supported headless tools
  workbench-cli state                             Inspect server runtime state
  workbench-cli run --tool <key> [options]        Execute a tool

Options for run:
  --tool <key>       Tool key, e.g. BufferTool (required)
  --params <json>    Tool params as inline JSON (default: {})
  --state  <json>    Initial workbench state as inline JSON or a path to a JSON file (default: {})
  --pretty           Pretty-print the full response JSON

Examples:
  workbench-cli list
  workbench-cli run --tool RandomPointsTool --params '{"Points Count":5,"Inside Polygon":false}' --state '{"bbox":[-118.5,33.5,-118.2,33.8]}'
  workbench-cli run --tool ExportTool --params '{"Layer":"layer-1","Format":"GeoJSON"}' --state state.json
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length) return { command: null };
  const command = args[0];
  const flags = {};
  for (let i = 1; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      flags[key] = value;
      if (value !== true) i += 1;
    }
  }
  return { command, flags };
}

function parseJsonOrFile(value, flagName) {
  if (!value || value === true) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        throw new Error(`--${flagName} contains invalid JSON: ${err.message}`);
      }
    }
    const resolved = fs.realpathSync(trimmed);
    try {
      return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (err) {
      throw new Error(`--${flagName} file "${trimmed}" could not be read: ${err.message}`);
    }
  }
  return {};
}

function printToolList(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    console.log('No supported headless tools found.');
    return;
  }
  console.log(`Supported headless tools (${tools.length}):\n`);
  tools.forEach((tool) => {
    console.log(`  ${tool.key}`);
    if (tool.description) console.log(`    ${tool.description}`);
    if (tool.stateMode) console.log(`    state mode: ${tool.stateMode}`);
  });
}

async function cmdList(baseUrl) {
  const response = await requestJson(baseUrl, '/api/run');
  if (!response.ok) {
    throw new Error(`Discovery failed (HTTP ${response.status}): ${response.data?.error || 'unknown error'}`);
  }
  printToolList(response.data.supportedTools);
}

async function cmdState(baseUrl) {
  const response = await requestJson(baseUrl, '/api/state');
  if (!response.ok) {
    throw new Error(`State request failed (HTTP ${response.status}): ${response.data?.error || 'unknown error'}`);
  }
  console.log(JSON.stringify(response.data, null, 2));
}

async function cmdRun(baseUrl, flags) {
  const toolKey = flags.tool;
  if (!toolKey || toolKey === true) {
    throw new Error('--tool is required. Run `workbench-cli list` to see available tools.');
  }

  const params = parseJsonOrFile(flags.params, 'params');
  const state = parseJsonOrFile(flags.state, 'state');
  const pretty = Boolean(flags.pretty);

  const response = await requestJson(baseUrl, '/api/run', {
    method: 'POST',
    body: { tool: toolKey, params, state },
  });

  const data = response.data || {};

  if (!response.ok) {
    const errorMsg = data.error || `HTTP ${response.status}`;
    console.error(`Error: ${errorMsg}`);
    if (data.details) console.error('Details:', JSON.stringify(data.details, null, 2));
    process.exitCode = 1;
    return;
  }

  if (pretty) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const status = data.status || {};
  const execution = data.execution || {};
  const outputLayerIds = execution.outputLayerIds || [];
  const featureCounts = execution.featureCounts || {};
  const warnings = data.spatial?.warnings || [];

  const parts = [
    `tool=${toolKey}`,
    `ok=${data.ok}`,
    `status=${status.code}:${status.message || 'unknown'}`,
    `duration=${execution.durationMs ?? '?'}ms`,
    `outputLayers=${outputLayerIds.length ? outputLayerIds.join(',') : 'none'}`,
    `features=${featureCounts.input ?? 0}->${featureCounts.output ?? 0}`,
  ];
  if (warnings.length) parts.push(`warnings=${warnings.length}`);
  console.log(parts.join(' | '));

  warnings.forEach((w) => {
    console.log(`  warning[${w.code}]: ${w.message}`);
  });

  if (!data.ok) process.exitCode = 1;
}

async function main() {
  const { command, flags = {} } = parseArgs(process.argv);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  const runtimeManager = createHeadlessApiRuntimeManager();
  let runtime = null;

  try {
    runtime = await runtimeManager.getRuntime();
    const { baseUrl } = runtime;

    if (command === 'list') {
      await cmdList(baseUrl);
    } else if (command === 'state') {
      await cmdState(baseUrl);
    } else if (command === 'run') {
      await cmdRun(baseUrl, flags);
    } else {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
    }
  } finally {
    if (runtime && !process.env.HEADLESS_API_URL) {
      await runtimeManager.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
