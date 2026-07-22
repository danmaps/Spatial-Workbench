#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHeadlessApiRuntimeManager, requestJson } = require('../js/headless-api-client');

function formatReceipt(stepNumber, toolKey, response) {
  const execution = response.execution || {};
  const status = response.status || {};
  const inputLayerIds = execution.inputLayerIds || [];
  const outputLayerIds = execution.outputLayerIds || [];
  const featureCounts = execution.featureCounts || {};
  const warnings = response?.spatial?.warnings || [];

  const parts = [
    `[${stepNumber}/3] ${toolKey}`,
    `status=${status.code}:${status.message || 'unknown'}`,
    `duration=${execution.durationMs ?? '?'}ms`,
    `inputLayers=${inputLayerIds.length ? inputLayerIds.join(',') : 'none'}`,
    `outputLayers=${outputLayerIds.length ? outputLayerIds.join(',') : 'none'}`,
    `features=${featureCounts.input ?? 0}->${featureCounts.output ?? 0}`,
  ];

  if (warnings.length) {
    parts.push(`warnings=${warnings.length}`);
  }

  return parts.join(' | ');
}

function printWarnings(response) {
  const warnings = Array.isArray(response?.spatial?.warnings) ? response.spatial.warnings : [];
  warnings.forEach((warning) => {
    console.log(`  warning[${warning.code}]: ${warning.message}`);
  });
}

function getAddedLayerId(response, toolKey) {
  const layerId = response?.state?.added?.[0]?.id;
  if (!layerId) {
    throw new Error(`${toolKey} did not return an added layer receipt.`);
  }
  return layerId;
}

function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.data?.error || response.error || 'HTTP error'}`);
  }
  if (!response.data?.ok) {
    const message = response.data?.status?.message || response.data?.error || 'Unknown tool error';
    throw new Error(`${label} failed: ${message}`);
  }
}

async function main() {
  const runtimeManager = createHeadlessApiRuntimeManager();
  let runtime = null;

  try {
    runtime = await runtimeManager.getRuntime();
    const baseUrl = runtime.baseUrl;
    console.log(process.env.HEADLESS_API_URL ? `Using headless API at ${baseUrl}` : `Started local headless API at ${baseUrl}`);

    const discovery = await requestJson(baseUrl, '/api/run');
    assertOk(discovery, 'Discovery');

    const supportedTools = Array.isArray(discovery.data.supportedTools) ? discovery.data.supportedTools : [];
    const requiredTools = ['RandomPointsTool', 'BufferTool', 'ExportTool'];
    const advertisedTools = new Set(supportedTools.map((tool) => tool.key));
    requiredTools.forEach((toolKey) => {
      if (!advertisedTools.has(toolKey)) {
        throw new Error(`Discovery is missing required tool ${toolKey}.`);
      }
    });

    let state = {
      bbox: [-118.5, 33.5, -118.2, 33.8],
    };

    const randomPoints = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'RandomPointsTool',
        params: {
          'Points Count': 5,
          'Inside Polygon': false,
        },
        state,
      },
    });
    assertOk(randomPoints, 'RandomPointsTool');
    console.log(formatReceipt(1, 'RandomPointsTool', randomPoints.data));
    printWarnings(randomPoints.data);
    state = randomPoints.data.state;
    const randomPointsLayerId = getAddedLayerId(randomPoints.data, 'RandomPointsTool');

    const buffer = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'BufferTool',
        params: {
          'Input Layer': randomPointsLayerId,
          Distance: 0.5,
          Units: 'kilometers',
        },
        state,
      },
    });
    assertOk(buffer, 'BufferTool');
    console.log(formatReceipt(2, 'BufferTool', buffer.data));
    printWarnings(buffer.data);
    state = buffer.data.state;
    const bufferedLayerId = getAddedLayerId(buffer.data, 'BufferTool');

    const exportResult = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'ExportTool',
        params: {
          Layer: bufferedLayerId,
          Format: 'GeoJSON',
        },
        state,
      },
    });
    assertOk(exportResult, 'ExportTool');
    console.log(formatReceipt(3, 'ExportTool', exportResult.data));
    printWarnings(exportResult.data);

    const artifactData = exportResult.data?.output?.download?.data;
    if (typeof artifactData !== 'string' || !artifactData.trim()) {
      throw new Error('ExportTool did not return serialized GeoJSON data.');
    }

    const artifactDir = path.join(__dirname, '..', 'artifacts');
    const artifactPath = path.join(artifactDir, 'headless-demo.geojson');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(artifactPath, `${artifactData}\n`, 'utf8');
    console.log(`Wrote ${artifactPath}`);
  } finally {
    if (runtime && !process.env.HEADLESS_API_URL) {
      await runtimeManager.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
