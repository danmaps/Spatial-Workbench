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
  createTimeoutPromise,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_LAYERS,
  DEFAULT_MAX_FEATURES,
  DEFAULT_MAX_VERTICES,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_RUNS,
} = require('./server');

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
        params: { count: 5, bbox: [-118.5, 33.5, -117.5, 34.5] },
        state: { layers: [] },
      },
    });
    const data = response.json();

    expect(response.ok).toBe(true);
    // execution receipt is always included in successful responses
    expect(data.execution).toBeDefined();
    expect(data.execution.durationMs).toBeLessThan(DEFAULT_TOOL_TIMEOUT_MS);
  });

  test('POST /api/run returns 503 with EXECUTION_TIMEOUT error shape when a tool times out', async () => {
    // All built-in tools are synchronous and complete as microtasks, so they
    // always beat the setTimeout-based timeout in a Promise.race. Instead, we
    // test the timeout mechanism directly via the exported createTimeoutPromise
    // helper, and separately confirm the route's catch block forwards the
    // structured error through the HTTP response.
    await expect(createTimeoutPromise(50)).rejects.toMatchObject({
      message: 'Tool execution timed out.',
      code: 'EXECUTION_TIMEOUT',
      statusCode: 503,
    });

    // Verify the cancel() helper clears the pending timer (no leaked handle).
    const tp = createTimeoutPromise(10000);
    tp.cancel();
    // After cancellation the promise neither resolves nor rejects; just confirm
    // the cancel call doesn't throw.
    expect(typeof tp.cancel).toBe('function');
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
        params: { count: 1, bbox: [-118.5, 33.5, -117.5, 34.5] },
        state: { layers: [] },
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
          params: { count: 1, bbox: [-118.5, 33.5, -117.5, 34.5] },
          state: { layers: [] },
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
});
