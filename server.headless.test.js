const http = require('http');
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

function readFixtureJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'test/fixtures/headless-api', filename), 'utf8'));
}

const sourcePointsGeojson = readFixtureJson('source-points.geojson');
const boundaryPolygonGeojson = readFixtureJson('boundary-polygon.geojson');
const expectedExportSourcePoints = readFixtureJson('expected-export-source-points.geojson');
const expectedConvertedSourcePoints = readFixtureJson('expected-convert-text-to-numeric.geojson');
const expectedGroupedPoints = readFixtureJson('expected-grouped-points.geojson');
const expectedBufferSummary = readFixtureJson('expected-buffer-summary.json');
const turfBufferPolygonWithHoles = readFixtureJson('turf-derived/buffer-polygon-with-holes.geojson');
const expectedTurfBufferPolygonWithHolesSummary = readFixtureJson('turf-derived/expected-buffer-polygon-with-holes-summary.json');
const turfDbscanPointsWithProperties = readFixtureJson('turf-derived/dbscan-points-with-properties.geojson');
const expectedTurfDbscanGroupSummary = readFixtureJson('turf-derived/expected-dbscan-group-summary.json');
const turfPolygonWithHole = readFixtureJson('turf-derived/polygon-with-hole.geojson');

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeToolOutputGeojson(geojson) {
  const normalized = clone(geojson);
  delete normalized.toolMetadata;
  if (Array.isArray(normalized.features)) {
    normalized.features = normalized.features.map((feature) => {
      const nextFeature = { ...feature };
      delete nextFeature.toolMetadata;
      if (nextFeature.properties) {
        nextFeature.properties = { ...nextFeature.properties };
        delete nextFeature.properties.toolMetadata;
      }
      return nextFeature;
    });
  }
  return normalized;
}

function summarizeBufferLayer(layer) {
  return {
    name: layer.name,
    geometryType: layer.geometryType,
    featureCount: layer.geojson.features.length,
    featureSummaries: layer.geojson.features.map((feature) => ({
      id: feature.properties.__id,
      name: feature.properties.name,
      geometryType: feature.geometry.type,
    })),
    toolMetadata: {
      name: layer.geojson.toolMetadata.name,
      params: layer.geojson.toolMetadata.params,
      parentLayerId: layer.geojson.toolMetadata.parentLayerId,
    },
  };
}

function summarizeSingleFeatureBufferLayer(layer) {
  const geojson = layer.geojson;
  return {
    name: layer.name,
    type: geojson.type,
    geometryType: geojson.geometry.type,
    ringCount: geojson.geometry.coordinates.length,
    firstRingVertexCount: geojson.geometry.coordinates[0].length,
    properties: geojson.properties,
    toolMetadata: {
      name: geojson.toolMetadata.name,
      parentLayerId: geojson.toolMetadata.parentLayerId,
      params: geojson.toolMetadata.params,
    },
  };
}

function summarizeGroupFeatures(geojson) {
  return {
    featureSummaries: geojson.features.map((feature) => ({
      id: feature.properties.__id,
      markerSymbol: feature.properties['marker-symbol'],
      grouped: feature.properties.grouped,
      groupId: feature.properties.groupId,
      groupStatus: feature.properties.groupStatus,
      groupDbscanRole: feature.properties.groupDbscanRole,
      groupSize: feature.properties.groupSize,
    })),
  };
}

const sourcePointLayer = {
  id: 'source-layer',
  name: 'Sample source points',
  geojson: sourcePointsGeojson,
};

const polygonLayer = {
  id: 'polygon-layer',
  name: 'Sample boundary',
  geojson: boundaryPolygonGeojson,
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
      expect.arrayContaining(['BufferTool', 'RandomPointsTool', 'ExportTool', 'ConvertTextToNumericTool'])
    );
    expect(data.supportedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'BufferTool', stateMode: 'layers' }),
      expect.objectContaining({ key: 'ConvertTextToNumericTool', stateMode: 'featureCollection' }),
    ]));
    expect(data.requestShape).toEqual(expect.objectContaining({
      tool: 'BufferTool',
      params: expect.any(Object),
      state: expect.any(Object),
    }));
  });

  test('POST /api/run buffers sample GeoJSON and returns a known polygon result shape', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'BufferTool',
        params: {
          'Input Layer': 'source-layer',
          Distance: 1,
          Units: 'kilometers',
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
    const bufferLayer = data.state.layers.find((layer) => layer.id === data.state.added[0].id);
    expect(bufferLayer.name).toBe('Buffer');
    expect(bufferLayer.geometryType).toBe('Polygon');
    expect(bufferLayer.geojson).toEqual(expect.objectContaining({
      type: 'FeatureCollection',
      features: expect.arrayContaining([
        expect.objectContaining({
          type: 'Feature',
          geometry: expect.objectContaining({ type: 'Polygon' }),
          properties: expect.objectContaining({
            __id: 'warehouse-a',
            name: 'Warehouse A',
            population_text: '1,234 people',
          }),
        }),
      ]),
      toolMetadata: expect.objectContaining({
        name: 'Buffer',
        params: expect.objectContaining({
          'Input Layer': 'source-layer',
          Distance: 1,
          Units: 'kilometers',
        }),
        parentLayerId: 'source-layer',
      }),
    }));
    expect(bufferLayer.geojson.features).toHaveLength(sourcePointsGeojson.features.length);
    expect(summarizeBufferLayer(bufferLayer)).toEqual(expectedBufferSummary);
  });

  test('POST /api/run buffers a Turf polygon-with-holes fixture through the API', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'BufferTool',
        params: {
          'Input Layer': 'turf-poly-hole',
          Distance: 50,
          Units: 'miles',
        },
        state: {
          layers: [
            {
              id: 'turf-poly-hole',
              name: 'Turf polygon with holes',
              geojson: turfBufferPolygonWithHoles,
            },
          ],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining({ code: 0, message: 'Buffered layer added to map.' }));
    expect(data.state.added).toHaveLength(1);
    const bufferLayer = data.state.added[0];
    expect(summarizeSingleFeatureBufferLayer(bufferLayer)).toEqual(expectedTurfBufferPolygonWithHolesSummary);
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
        data: JSON.stringify(expectedExportSourcePoints),
      }),
    }));
    expect(JSON.parse(data.output.download.data)).toEqual(expectedExportSourcePoints);
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
        expectedStatus: { code: 2, message: 'Map bounds are unavailable.' },
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
      expect(data.validation).toEqual(expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining([scenario.expectedStatus.message]),
      }));
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
    resultLayer.geojson.features.forEach((feature) => {
      expect(turf.booleanPointInPolygon(feature, boundaryPolygonGeojson)).toBe(true);
    });
  });

  test('POST /api/run keeps random points out of a Turf polygon hole', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'RandomPointsTool',
        params: {
          'Points Count': 5,
          'Inside Polygon': true,
          Polygon: 'turf-hole-polygon',
        },
        state: {
          layers: [
            {
              id: 'turf-hole-polygon',
              name: 'Turf polygon with hole',
              geojson: turfPolygonWithHole,
            },
          ],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining({ code: 0, message: 'Added 5 point(s).' }));
    const resultLayer = data.state.added[0];
    expect(resultLayer.geojson.features).toHaveLength(5);
    resultLayer.geojson.features.forEach((feature) => {
      expect(turf.booleanPointInPolygon(feature, turfPolygonWithHole)).toBe(true);
    });
  });

  test('POST /api/run groups sample GeoJSON and matches the known-good grouped output', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'GroupTool',
        params: {
          Layer: 'source-layer',
          Distance: 5,
          Units: 'kilometers',
        },
        state: {
          layers: [sourcePointLayer],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining({
      code: 0,
      message: 'Grouped 4 feature(s) into 1 group(s), 1 ungrouped.',
    }));
    expect(data.state.added).toHaveLength(1);
    const resultLayer = data.state.layers.find((layer) => layer.id === data.state.added[0].id);
    expect(resultLayer.name).toBe('Group');
    expect(normalizeToolOutputGeojson(resultLayer.geojson)).toEqual(expectedGroupedPoints);
  });

  test('POST /api/run groups Turf DBSCAN points while preserving source properties', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'GroupTool',
        params: {
          Layer: 'turf-dbscan',
          Distance: 100,
          Units: 'kilometers',
        },
        state: {
          layers: [
            {
              id: 'turf-dbscan',
              name: 'Turf DBSCAN points',
              geojson: turfDbscanPointsWithProperties,
            },
          ],
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toEqual(expect.objectContaining(expectedTurfDbscanGroupSummary.status));
    expect(data.state.added).toHaveLength(1);
    expect(summarizeGroupFeatures(data.state.added[0].geojson)).toEqual({
      featureSummaries: expectedTurfDbscanGroupSummary.featureSummaries,
    });
  });

  test('POST /api/run converts sample GeoJSON attributes and matches the known-good output', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'ConvertTextToNumericTool',
        params: {
          'Input Field Name': 'population_text',
          'Output Field Name': 'population',
          'Overwrite Existing Field': false,
          'Use AI Fallback': false,
        },
        state: {
          featureCollection: sourcePointsGeojson,
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({
      ok: true,
      tool: 'ConvertTextToNumericTool',
      status: expect.objectContaining({ code: 0, message: 'Converted 3 feature(s); 1 failed.' }),
      output: expect.objectContaining({
        ok: true,
        updatedCount: 4,
        convertedCount: 3,
        failedFeatureIds: ['outpost-d'],
      }),
      state: expect.objectContaining({
        featureCollection: expect.objectContaining({
          type: 'FeatureCollection',
        }),
        selection: { featureIds: [] },
      }),
    }));
    expect(data.output.state).toBeUndefined();
    expect(normalizeToolOutputGeojson(data.state.featureCollection)).toEqual(expectedConvertedSourcePoints);
  });

  test('POST /api/run validates featureCollection tools before execution', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: {
        tool: 'ConvertTextToNumericTool',
        params: {
          'Input Field Name': 'population_text',
          'Output Field Name': '',
          'Use AI Fallback': false,
        },
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { __id: 'feature-1', population_text: '1,234 people' },
                geometry: { type: 'Point', coordinates: [0, 0] },
              },
            ],
          },
        },
      },
    });
    const data = response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({
      ok: false,
      tool: 'ConvertTextToNumericTool',
      status: expect.objectContaining({ code: 2, message: 'Output Field Name is required.' }),
      validation: { ok: false, errors: ['Output Field Name is required.'] },
      output: null,
      state: expect.objectContaining({
        featureCollection: expect.objectContaining({
          features: [
            expect.objectContaining({
              properties: expect.not.objectContaining({ population: expect.anything() }),
            }),
          ],
        }),
      }),
    }));
  });
});
