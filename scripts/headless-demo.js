#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

function requestJson(baseUrl, requestPath, options = {}) {
  const url = new URL(requestPath, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: body
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          }
        : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data || '{}');
        } catch (error) {
          reject(new Error(`Failed to parse ${requestPath} response: ${error.message}`));
          return;
        }

        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data: parsed,
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function formatReceipt(stepNumber, toolKey, response) {
  const execution = response.execution || {};
  const status = response.status || {};
  const inputLayerIds = execution.inputLayerIds || [];
  const outputLayerIds = execution.outputLayerIds || [];
  const featureCounts = execution.featureCounts || {};

  return [
    `[${stepNumber}/3] ${toolKey}`,
    `status=${status.code}:${status.message || 'unknown'}`,
    `duration=${execution.durationMs ?? '?'}ms`,
    `inputLayers=${inputLayerIds.length ? inputLayerIds.join(',') : 'none'}`,
    `outputLayers=${outputLayerIds.length ? outputLayerIds.join(',') : 'none'}`,
    `features=${featureCounts.input ?? 0}->${featureCounts.output ?? 0}`,
  ].join(' | ');
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
    throw new Error(`${label} failed: ${response.error || 'HTTP error'}`);
  }
  if (!response.data?.ok) {
    const message = response.data?.status?.message || response.data?.error || 'Unknown tool error';
    throw new Error(`${label} failed: ${message}`);
  }
}

async function startLocalServer() {
  global.turf = require('@turf/turf');
  global.L = { Polygon: function Polygon() {} };

  const { app } = require('../server');
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function main() {
  let runtime = null;
  let baseUrl = process.env.HEADLESS_API_URL;

  try {
    if (!baseUrl) {
      runtime = await startLocalServer();
      baseUrl = runtime.baseUrl;
      console.log(`Started local headless API at ${baseUrl}`);
    } else {
      console.log(`Using headless API at ${baseUrl}`);
    }

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
    if (runtime) {
      await runtime.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
