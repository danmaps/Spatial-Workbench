const http = require('http');
const turf = require('@turf/turf');

global.turf = turf;
global.L = {
  Polygon: function Polygon() {},
};

const { app } = require('./server');

function requestJson(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => JSON.parse(data || '{}'),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sourcePointLayer = {
  id: 'source-layer',
  name: 'Source Layer',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { name: 'origin' },
      },
    ],
  },
};

const polygonLayer = {
  id: 'polygon-layer',
  name: 'Polygon Layer',
  geojson: {
    type: 'Feature',
    properties: { name: 'test polygon' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
        [0, 0],
      ]],
    },
  },
};

describe('/api/run', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  test('GET /api/run returns discovery metadata', async () => {
    const response = await requestJson(baseUrl, '/api/run');
    const data = response.json();

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.method).toBe('POST');
    expect(Array.isArray(data.supportedTools)).toBe(true);
    expect(data.supportedTools.map((tool) => tool.key)).toEqual(
      expect.arrayContaining(['BufferTool', 'RandomPointsTool', 'ExportTool'])
    );
    expect(data.requestShape).toEqual(expect.objectContaining({
      tool: 'BufferTool',
      params: expect.any(Object),
      state: expect.any(Object),
    }));
  });

  test('POST /api/run buffers a request-scoped layer and returns the result contract', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'BufferTool',
        params: {
          'Input Layer': 'source-layer',
          Distance: 5,
          Units: 'miles',
        },
        state: {
          layers: [sourcePointLayer],
          bbox: [-1, -1, 1, 1],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({
      ok: true,
      tool: 'BufferTool',
      status: expect.objectContaining({ code: 0, message: 'Buffered layer added to map.' }),
      output: expect.objectContaining({ ok: true, added: expect.any(Array), removed: expect.any(Array) }),
      state: expect.objectContaining({
        added: expect.any(Array),
        removed: [],
        layers: expect.any(Array),
        bbox: [-1, -1, 1, 1],
      }),
    }));
    expect(data.state.added).toHaveLength(1);
    expect(data.state.layers).toHaveLength(2);
    expect(data.state.layers.map((layer) => layer.id)).toEqual(expect.arrayContaining(['source-layer']));
  });

  test('POST /api/run supports RandomPointsTool against request bbox without leaking prior state', async () => {
    const firstResponse = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'RandomPointsTool',
        params: {
          'Points Count': 3,
          'Inside Polygon': false,
        },
        state: {
          bbox: [10, 20, 11, 21],
        },
      },
    });
    const firstData = firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstData.ok).toBe(true);
    expect(firstData.status).toEqual(expect.objectContaining({ code: 0 }));
    expect(firstData.output).toEqual(expect.objectContaining({ ok: true, added: expect.any(Array), removed: [] }));
    expect(firstData.state.bbox).toEqual([10, 20, 11, 21]);
    expect(firstData.state.added).toHaveLength(1);
    expect(firstData.state.layers).toHaveLength(1);
    expect(firstData.state.layers[0]).toEqual(expect.objectContaining({
      geojson: expect.objectContaining({
        type: 'FeatureCollection',
        features: expect.arrayContaining([
          expect.objectContaining({ geometry: expect.objectContaining({ type: 'Point' }) }),
        ]),
      }),
    }));
    expect(firstData.state.layers[0].geojson.features).toHaveLength(3);

    const secondResponse = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'ExportTool',
        params: {
          Layer: firstData.state.added[0].id,
          Format: 'GeoJSON',
        },
        state: {
          layers: [],
        },
      },
    });
    const secondData = secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondData.ok).toBe(false);
    expect(secondData.status).toEqual(expect.objectContaining({ code: 2, message: 'No layer selected.' }));
    expect(secondData.output).toBe(null);
    expect(secondData.state).toEqual(expect.objectContaining({
      added: [],
      removed: [],
      layers: [],
      bbox: null,
    }));
  });

  test('POST /api/run exports a request-scoped layer as GeoJSON', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'ExportTool',
        params: {
          Layer: 'source-layer',
          Format: 'GeoJSON',
        },
        state: {
          layers: [sourcePointLayer],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining({ code: 0, message: 'Prepared GeoJSON export.' }));
    expect(data.output).toEqual(expect.objectContaining({
      download: expect.objectContaining({
        filename: 'source-layer.geojson',
        mimeType: 'application/json',
        data: JSON.stringify(sourcePointLayer.geojson),
      }),
    }));
    expect(data.state).toEqual(expect.objectContaining({
      added: [],
      removed: [],
      layers: [expect.objectContaining({ id: 'source-layer' })],
      bbox: null,
    }));
  });

  test('POST /api/run returns 400 for unsupported tools', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: { tool: 'AddDataTool', params: {}, state: {} },
    });
    const data = response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain('Unsupported headless tool');
    expect(data.details.supportedTools).toEqual(
      expect.arrayContaining(['BufferTool', 'RandomPointsTool', 'ExportTool'])
    );
  });

  test('POST /api/run reports tool validation failures without crashing the API', async () => {
    const scenarios = [
      {
        name: 'BufferTool missing layer and distance',
        body: {
          tool: 'BufferTool',
          params: { Units: 'miles' },
          state: { layers: [] },
        },
        expectedStatus: { code: 2, message: 'No layer selected.' },
      },
      {
        name: 'RandomPointsTool missing bbox/state for bounds mode',
        body: {
          tool: 'RandomPointsTool',
          params: {
            'Points Count': 2,
            'Inside Polygon': false,
          },
          state: {},
        },
        expectedStatus: { code: 3, message: 'Map bounds are unavailable.' },
      },
      {
        name: 'RandomPointsTool missing polygon layer for inside-polygon mode',
        body: {
          tool: 'RandomPointsTool',
          params: {
            'Points Count': 2,
            'Inside Polygon': true,
          },
          state: { layers: [] },
        },
        expectedStatus: { code: 2, message: 'No polygon selected.' },
      },
      {
        name: 'ExportTool missing layer',
        body: {
          tool: 'ExportTool',
          params: { Format: 'GeoJSON' },
          state: { layers: [] },
        },
        expectedStatus: { code: 2, message: 'No layer selected.' },
      },
    ];

    for (const scenario of scenarios) {
      const response = await requestJson(baseUrl, '/api/run', {
        method: 'POST',
        body: scenario.body,
      });
      const data = response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(false);
      expect(data.status).toEqual(expect.objectContaining(scenario.expectedStatus));
      expect(data.output).toBe(null);
      expect(data.state).toEqual(expect.objectContaining({
        added: [],
        removed: [],
        layers: expect.any(Array),
      }));
    }
  });

  test('POST /api/run supports RandomPointsTool inside a polygon from request state', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'RandomPointsTool',
        params: {
          'Points Count': 2,
          'Inside Polygon': true,
          Polygon: 'polygon-layer',
        },
        state: {
          layers: [polygonLayer],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining({ code: 0, message: 'Added 2 point(s).' }));
    expect(data.output).toEqual(expect.objectContaining({ ok: true, added: expect.any(Array), removed: [] }));
    expect(data.state.added).toHaveLength(1);
    expect(data.state.layers).toHaveLength(2);
    const resultLayer = data.state.layers.find((layer) => layer.id === data.state.added[0].id);
    expect(resultLayer).toEqual(expect.objectContaining({
      geojson: expect.objectContaining({
        type: 'FeatureCollection',
        features: expect.arrayContaining([
          expect.objectContaining({ geometry: expect.objectContaining({ type: 'Point' }) }),
        ]),
      }),
    }));
    expect(resultLayer.geojson.features).toHaveLength(2);
  });
});
