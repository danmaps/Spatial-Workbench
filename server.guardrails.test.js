/**
 * @jest-environment node
 *
 * Tests for API workload guardrails: payload size, feature/layer/vertex limits,
 * execution timeout, concurrency cap, and rate limiting on POST /api/run.
 *
 * Uses the `node` Jest environment so that process.env mutations are shared
 * with the same-process server handler. Limits are read dynamically from env
 * vars per request; tests set overrides inline and restore them in finally blocks.
 */

const http = require('http');
const turf = require('@turf/turf');

global.turf = turf;
global.L = { Polygon: function Polygon() {} };

const {
  app,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_LAYERS,
  DEFAULT_MAX_FEATURES,
  DEFAULT_MAX_VERTICES,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_MAX_RANDOM_POINTS,
  DEFAULT_MAX_BUFFER_DISTANCE,
} = require('./server');
const { getActiveWorkerCount } = require('./js/runtime/workerExecutor');

// ---------------------------------------------------------------------------
// HTTP helpers (mirrors server.headless.test.js style)
// ---------------------------------------------------------------------------

function requestJson(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method || (body ? 'POST' : 'GET'),
        headers: {
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: res.headers,
            json: () => JSON.parse(data || '{}'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestRaw(baseUrl, path, rawBody) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: () => JSON.parse(data || '{}'),
          });
        });
      },
    );
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

function makeFeatureCollection(count) {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [i * 0.001 - 118, 34] },
      properties: { id: i },
    })),
  };
}

function makeLayers(count, featuresPerLayer = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `layer-${i + 1}`,
    name: `Layer ${i + 1}`,
    geojson: makeFeatureCollection(featuresPerLayer),
  }));
}

function makeDensePolygonFeatureCollection(vertexCount = 50000) {
  const ring = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const radius = 1 + (0.2 * Math.sin(10 * angle));
    ring.push([
      -118 + (radius * Math.cos(angle) * 0.1),
      34 + (radius * Math.sin(angle) * 0.1),
    ]);
  }
  ring.push(ring[0]);

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    }],
  };
}

async function waitForActiveRuns(expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (getActiveWorkerCount() !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getActiveWorkerCount();
}

// ---------------------------------------------------------------------------

describe('API workload guardrails', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  // -------------------------------------------------------------------------
  // Exported defaults
  // -------------------------------------------------------------------------

  test('default limit constants are exported as positive integers', () => {
    expect(DEFAULT_MAX_REQUEST_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_MAX_LAYERS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_FEATURES).toBeGreaterThan(0);
    expect(DEFAULT_MAX_VERTICES).toBeGreaterThan(0);
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_CONCURRENT_RUNS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_RANDOM_POINTS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_BUFFER_DISTANCE).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_REQUEST_BYTES)).toBe(true);
    expect(Number.isInteger(DEFAULT_MAX_LAYERS)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // /api/state exposes workload limits
  // -------------------------------------------------------------------------

  test('GET /api/state exposes workloadLimits with all expected fields', async () => {
    const response = await requestJson(baseUrl, '/api/state');
    const data = response.json();

    expect(response.ok).toBe(true);
    expect(data.workloadLimits).toEqual(
      expect.objectContaining({
        maxRequestBytes: expect.any(Number),
        maxLayers: expect.any(Number),
        maxFeatures: expect.any(Number),
        maxVertices: expect.any(Number),
        toolTimeoutMs: expect.any(Number),
        maxConcurrentRuns: expect.any(Number),
      }),
    );
    expect(data.workloadLimits.maxRequestBytes).toBe(DEFAULT_MAX_REQUEST_BYTES);
    expect(data.workloadLimits.maxLayers).toBe(DEFAULT_MAX_LAYERS);
    expect(data.workloadLimits.maxFeatures).toBe(DEFAULT_MAX_FEATURES);
    expect(data.workloadLimits.maxVertices).toBe(DEFAULT_MAX_VERTICES);
    expect(data.workloadLimits.toolTimeoutMs).toBe(DEFAULT_TOOL_TIMEOUT_MS);
    expect(data.workloadLimits.maxConcurrentRuns).toBe(DEFAULT_MAX_CONCURRENT_RUNS);
  });

  // -------------------------------------------------------------------------
  // Payload size limit
  // -------------------------------------------------------------------------

  test('POST /api/run returns 413 with PAYLOAD_TOO_LARGE for an oversized request body', async () => {
    const targetSize = DEFAULT_MAX_REQUEST_BYTES + 512 * 1024;
    const padding = 'x'.repeat(targetSize);
    const rawBody = JSON.stringify({
      tool: 'ExportTool',
      params: { format: 'geojson', layerId: 'layer-1' },
      state: { layers: [{ id: 'layer-1', name: 'L', geojson: { pad: padding } }] },
    });

    if (Buffer.byteLength(rawBody) <= DEFAULT_MAX_REQUEST_BYTES) {
      return; // skip if we couldn't build a body large enough
    }

    const response = await requestRaw(baseUrl, '/api/run', rawBody);
    const data = response.json();

    expect(response.status).toBe(413);
    expect(data.ok).toBe(false);
    expect(data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(data.limit).toBe(DEFAULT_MAX_REQUEST_BYTES);
  });

  // -------------------------------------------------------------------------
  // Layer count limit
  // -------------------------------------------------------------------------

  test('POST /api/run returns 422 with LAYER_LIMIT when layers exceed MAX_LAYERS', async () => {
    process.env.MAX_LAYERS = '3';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: { layers: makeLayers(4) },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('LAYER_LIMIT');
      expect(data.limit).toBe(3);
      expect(data.received).toBe(4);
    } finally {
      delete process.env.MAX_LAYERS;
    }
  });

  test('POST /api/run accepts a request exactly at the layer limit', async () => {
    process.env.MAX_LAYERS = '3';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: { layers: makeLayers(3) },
        },
      });
      const data = response.json();

      expect(data.code).not.toBe('LAYER_LIMIT');
    } finally {
      delete process.env.MAX_LAYERS;
    }
  });

  // -------------------------------------------------------------------------
  // Feature count limit
  // -------------------------------------------------------------------------

  test('POST /api/run returns 422 with FEATURE_LIMIT when total features exceed MAX_FEATURES', async () => {
    process.env.MAX_FEATURES = '5';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: {
            layers: [{
              id: 'layer-1',
              name: 'Layer',
              geojson: makeFeatureCollection(6),
            }],
          },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('FEATURE_LIMIT');
      expect(data.limit).toBe(5);
      expect(data.received).toBe(6);
    } finally {
      delete process.env.MAX_FEATURES;
    }
  });

  test('POST /api/run counts features across all layers for the feature limit', async () => {
    process.env.MAX_FEATURES = '5';
    try {
      // 3 layers × 2 features = 6 total → over limit of 5
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: { layers: makeLayers(3, 2) },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.code).toBe('FEATURE_LIMIT');
      expect(data.limit).toBe(5);
      expect(data.received).toBe(6);
    } finally {
      delete process.env.MAX_FEATURES;
    }
  });

  // -------------------------------------------------------------------------
  // Vertex count limit
  // -------------------------------------------------------------------------

  test('POST /api/run returns 422 with VERTEX_LIMIT when total vertices exceed MAX_VERTICES', async () => {
    process.env.MAX_VERTICES = '5';
    try {
      const coords = [
        [-118, 34], [-117, 34], [-117, 35], [-118, 35], [-118.5, 34.5], [-118, 34],
      ];
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: {
            layers: [{
              id: 'layer-1',
              name: 'Dense polygon',
              geojson: {
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Polygon', coordinates: [coords] },
                  properties: {},
                }],
              },
            }],
          },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('VERTEX_LIMIT');
      expect(data.limit).toBe(5);
      expect(data.received).toBe(6);
    } finally {
      delete process.env.MAX_VERTICES;
    }
  });

  // -------------------------------------------------------------------------
  // Execution timeout
  // -------------------------------------------------------------------------

  test('DEFAULT_TOOL_TIMEOUT_MS is a positive finite integer', () => {
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_TOOL_TIMEOUT_MS)).toBe(true);
  });

  test('fast tools complete well within the default timeout budget', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      body: {
        tool: 'RandomPointsTool',
        params: { 'Points Count': 5 },
        state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
      },
    });
    const data = response.json();

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    // execution receipt is always included in successful responses
    expect(data.execution).toBeDefined();
    expect(data.execution.durationMs).toBeLessThan(DEFAULT_TOOL_TIMEOUT_MS);
  });

  test('POST /api/run returns 503 with EXECUTION_TIMEOUT when the deadline elapses', async () => {
    // Execution happens in a worker thread; a 1 ms budget always elapses before
    // the worker can boot and finish, so this exercises the real HTTP timeout
    // path (including worker termination) rather than a timer in isolation.
    process.env.TOOL_TIMEOUT_MS = '1';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'RandomPointsTool',
          params: { 'Points Count': 5 },
          state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
        },
      });
      const data = response.json();

      expect(response.status).toBe(503);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('EXECUTION_TIMEOUT');
      expect(typeof data.error).toBe('string');
    } finally {
      delete process.env.TOOL_TIMEOUT_MS;
    }
  });

  test('timeout does not block unrelated parent-process requests while worker is running', async () => {
    process.env.TOOL_TIMEOUT_MS = '25';
    try {
      const timedOutRun = requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'BufferTool',
          params: { 'Input Layer': 'dense', Distance: 1, Units: 'kilometers' },
          state: {
            layers: [{
              id: 'dense',
              name: 'Dense Polygon',
              geojson: makeDensePolygonFeatureCollection(50000),
            }],
          },
        },
      });

      const stateStartedAt = Date.now();
      const stateResponse = await requestJson(baseUrl, '/api/state');
      const stateDurationMs = Date.now() - stateStartedAt;
      const timedOutResponse = await timedOutRun;
      const timedOutData = timedOutResponse.json();

      expect(stateResponse.status).toBe(200);
      expect(stateDurationMs).toBeLessThan(400);
      expect(timedOutResponse.status).toBe(503);
      expect(timedOutData.code).toBe('EXECUTION_TIMEOUT');
    } finally {
      delete process.env.TOOL_TIMEOUT_MS;
    }
  });

  test('concurrency slots are released after a timeout so later requests succeed', async () => {
    process.env.TOOL_TIMEOUT_MS = '1';
    try {
      const timedOut = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'RandomPointsTool',
          params: { 'Points Count': 5 },
          state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
        },
      });
      expect(timedOut.status).toBe(503);
    } finally {
      delete process.env.TOOL_TIMEOUT_MS;
    }

    // Wait for the terminated worker to fully exit and release its slot.
    await waitForActiveRuns(0);

    const response = await requestJson(baseUrl, '/api/run', {
      body: {
        tool: 'RandomPointsTool',
        params: { 'Points Count': 5 },
        state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  test('GET /api/state reports worker-thread isolation and a settled run count', async () => {
    await waitForActiveRuns(0);
    const response = await requestJson(baseUrl, '/api/state');
    const data = response.json();

    expect(data.execution).toEqual(
      expect.objectContaining({ isolation: 'worker-thread', activeRuns: 0 }),
    );
  });

  test('GET /api/state documents which limits are dynamic and which are startup-only', async () => {
    const response = await requestJson(baseUrl, '/api/state');
    const data = response.json();

    expect(data.limitConfiguration.dynamic).toEqual(
      expect.arrayContaining(['MAX_LAYERS', 'MAX_FEATURES', 'MAX_VERTICES', 'TOOL_TIMEOUT_MS', 'MAX_CONCURRENT_RUNS']),
    );
    expect(data.limitConfiguration.startupOnly).toEqual(
      expect.arrayContaining(['MAX_REQUEST_BYTES', 'API_RUN_RATE_LIMIT_MAX', 'API_RUN_RATE_LIMIT_WINDOW_MS']),
    );
  });

  test('concurrent requests are bounded by MAX_CONCURRENT_RUNS', async () => {
    await waitForActiveRuns(0);
    process.env.MAX_CONCURRENT_RUNS = '1';
    try {
      const body = {
        tool: 'RandomPointsTool',
        params: { 'Points Count': 200 },
        state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
      };
      const responses = await Promise.all([
        requestJson(baseUrl, '/api/run', { body }),
        requestJson(baseUrl, '/api/run', { body }),
        requestJson(baseUrl, '/api/run', { body }),
      ]);
      const statuses = responses.map((r) => r.status);

      expect(statuses).toContain(503);
      expect(statuses.filter((status) => status === 503).length).toBeGreaterThanOrEqual(1);
      responses
        .filter((r) => r.status === 503)
        .forEach((r) => expect(r.json().code).toBe('CONCURRENCY_LIMIT'));
    } finally {
      delete process.env.MAX_CONCURRENT_RUNS;
      await waitForActiveRuns(0);
    }
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  test('GET /api/state confirms rate limiting is active', async () => {
    const response = await requestJson(baseUrl, '/api/state');
    const data = response.json();

    expect(response.ok).toBe(true);
    expect(data.rateLimiting).toBe(true);
  });

  test('POST /api/run rate limiter returns structured 429 when limit is exceeded', async () => {
    // Load a fresh isolated server instance with a very low rate limit (2/min).
    const savedMax = process.env.API_RUN_RATE_LIMIT_MAX;
    const savedWindow = process.env.API_RUN_RATE_LIMIT_WINDOW_MS;

    process.env.API_RUN_RATE_LIMIT_MAX = '2';
    process.env.API_RUN_RATE_LIMIT_WINDOW_MS = '60000';

    jest.resetModules();
    global.turf = require('@turf/turf');
    global.L = { Polygon: function Polygon() {} };

    let freshServer;
    try {
      const { app: freshApp } = require('./server');
      freshServer = freshApp.listen(0);
      await new Promise((resolve) => freshServer.once('listening', resolve));
      const freshPort = freshServer.address().port;
      const freshBaseUrl = `http://127.0.0.1:${freshPort}`;

      const body = {
        tool: 'RandomPointsTool',
        params: { 'Points Count': 1 },
        state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
      };

      const resp1 = await requestJson(freshBaseUrl, '/api/run', { body });
      const resp2 = await requestJson(freshBaseUrl, '/api/run', { body });
      const resp3 = await requestJson(freshBaseUrl, '/api/run', { body });

      expect(resp1.status).toBe(200);
      expect(resp2.status).toBe(200);
      expect(resp3.status).toBe(429);

      const data3 = resp3.json();
      expect(data3.ok).toBe(false);
      expect(data3.code).toBe('RATE_LIMIT');
      expect(typeof data3.error).toBe('string');
    } finally {
      if (freshServer) {
        await new Promise((resolve, reject) =>
          freshServer.close((err) => (err ? reject(err) : resolve())),
        );
      }
      if (savedMax === undefined) delete process.env.API_RUN_RATE_LIMIT_MAX;
      else process.env.API_RUN_RATE_LIMIT_MAX = savedMax;
      if (savedWindow === undefined) delete process.env.API_RUN_RATE_LIMIT_WINDOW_MS;
      else process.env.API_RUN_RATE_LIMIT_WINDOW_MS = savedWindow;
    }
  });

  // -------------------------------------------------------------------------
  // Concurrency limit
  // -------------------------------------------------------------------------

  test('POST /api/run returns 503 with CONCURRENCY_LIMIT when concurrent run cap is reached', async () => {
    // MAX_CONCURRENT_RUNS=0 means activeRuns (0) >= maxConcurrentRuns (0),
    // simulating a fully saturated server without needing real concurrency.
    process.env.MAX_CONCURRENT_RUNS = '0';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'RandomPointsTool',
          params: { 'Points Count': 1 },
          state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
        },
      });
      const data = response.json();

      expect(response.status).toBe(503);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('CONCURRENCY_LIMIT');
      expect(typeof data.limit).toBe('number');
    } finally {
      delete process.env.MAX_CONCURRENT_RUNS;
    }
  });

  // -------------------------------------------------------------------------
  // GeometryCollection vertex counting
  // -------------------------------------------------------------------------

  test('POST /api/run counts vertices inside a GeometryCollection against the vertex limit', async () => {
    process.env.MAX_VERTICES = '4';
    try {
      // GeometryCollection with two LineStrings (3 + 3 = 6 vertices) exceeds limit of 4
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-gc' },
          state: {
            layers: [{
              id: 'layer-gc',
              name: 'GeometryCollection layer',
              geojson: {
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: {
                    type: 'GeometryCollection',
                    geometries: [
                      { type: 'LineString', coordinates: [[-118, 34], [-117, 34], [-116, 34]] },
                      { type: 'LineString', coordinates: [[-118, 35], [-117, 35], [-116, 35]] },
                    ],
                  },
                  properties: {},
                }],
              },
            }],
          },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('VERTEX_LIMIT');
      expect(data.limit).toBe(4);
      expect(data.received).toBe(6);
    } finally {
      delete process.env.MAX_VERTICES;
    }
  });

  // -------------------------------------------------------------------------
  // featureCollection-mode limits (stateMode: 'featureCollection')
  // -------------------------------------------------------------------------

  test('POST /api/run counts featureCollection features against the feature limit', async () => {
    process.env.MAX_FEATURES = '3';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'ExportTool',
          params: { format: 'geojson', layerId: 'layer-1' },
          state: {
            layers: [],
            featureCollection: makeFeatureCollection(4),
          },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('FEATURE_LIMIT');
      expect(data.limit).toBe(3);
      expect(data.received).toBe(4);
    } finally {
      delete process.env.MAX_FEATURES;
    }
  });

  // -------------------------------------------------------------------------
  // Tool-specific parameter bounds
  // -------------------------------------------------------------------------

  test('POST /api/run returns 422 with PARAM_LIMIT when RandomPointsTool "Points Count" exceeds MAX_RANDOM_POINTS', async () => {
    process.env.MAX_RANDOM_POINTS = '10';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'RandomPointsTool',
          params: { 'Points Count': 11 },
          state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('PARAM_LIMIT');
      expect(data.param).toBe('Points Count');
      expect(data.limit).toBe(10);
      expect(data.received).toBe(11);
    } finally {
      delete process.env.MAX_RANDOM_POINTS;
    }
  });

  test('POST /api/run accepts RandomPointsTool request exactly at MAX_RANDOM_POINTS', async () => {
    process.env.MAX_RANDOM_POINTS = '5';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'RandomPointsTool',
          params: { 'Points Count': 5 },
          state: { layers: [], bbox: [-118.5, 33.5, -117.5, 34.5] },
        },
      });
      const data = response.json();

      expect(data.code).not.toBe('PARAM_LIMIT');
      expect(data.ok).toBe(true);
    } finally {
      delete process.env.MAX_RANDOM_POINTS;
    }
  });

  test('POST /api/run returns 422 with PARAM_LIMIT when BufferTool "Distance" exceeds MAX_BUFFER_DISTANCE', async () => {
    process.env.MAX_BUFFER_DISTANCE = '100';
    try {
      const response = await requestJson(baseUrl, '/api/run', {
        body: {
          tool: 'BufferTool',
          params: { Distance: 101, Units: 'miles' },
          state: {
            layers: [{
              id: 'layer-1',
              name: 'Points',
              geojson: makeFeatureCollection(1),
            }],
          },
        },
      });
      const data = response.json();

      expect(response.status).toBe(422);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('PARAM_LIMIT');
      expect(data.param).toBe('Distance');
      expect(data.limit).toBe(100);
    } finally {
      delete process.env.MAX_BUFFER_DISTANCE;
    }
  });

  test('DEFAULT_MAX_RANDOM_POINTS and DEFAULT_MAX_BUFFER_DISTANCE are exported positive integers', () => {
    expect(DEFAULT_MAX_RANDOM_POINTS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_RANDOM_POINTS)).toBe(true);
    expect(DEFAULT_MAX_BUFFER_DISTANCE).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_BUFFER_DISTANCE)).toBe(true);
  });
});
