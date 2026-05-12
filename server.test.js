const http = require('http');

const mockGenerateFieldValues = jest.fn();

jest.mock('./js/ai/fieldGeneration', () => {
  const actual = jest.requireActual('./js/ai/fieldGeneration');
  return {
    ...actual,
    generateFieldValues: (...args) => mockGenerateFieldValues(...args),
  };
});

describe('headless API', () => {
  let app;
  let server;
  let baseUrl;

  beforeEach(async () => {
    jest.resetModules();
    mockGenerateFieldValues.mockReset();
    ({ app } = require('./server'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function postJson(pathname, payload) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const request = http.request(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: JSON.parse(data),
          });
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  test('POST /api/run executes AddAIGeneratedFieldTool headlessly', async () => {
    mockGenerateFieldValues.mockResolvedValue([
      { id: 'f-1', value: 'priority-a' },
    ]);

    const response = await postJson('/api/run', {
        tool: 'AddAIGeneratedFieldTool',
        params: {
          'Instruction': 'Generate a priority label',
          'Output Field Name': 'ai_label',
          'Source Fields': 'name',
          'Output Type': 'text',
        },
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', name: 'Main St' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            ],
          },
          selection: {
            featureIds: ['f-1'],
          },
        },
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.status.code).toBe(0);
    expect(response.body.result.state.featureCollection.features[0].properties.ai_label).toBe('priority-a');
  });

  test('POST /api/run returns 400 when tool status is non-zero', async () => {
    const response = await postJson('/api/run', {
      tool: 'AddAIGeneratedFieldTool',
      params: {
        'Output Field Name': 'ai_label',
      },
      state: {
        featureCollection: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { __id: 'f-1', name: 'Main St' }, geometry: { type: 'Point', coordinates: [0, 0] } },
          ],
        },
        selection: {
          featureIds: ['f-1'],
        },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.status.code).toBe(2);
    expect(response.body.error).toBe('Instruction is required.');
  });

  test('POST /api/ai_structured validates request body', async () => {
    const response = await postJson('/api/ai_structured', {
      systemPrompt: '',
      userPrompt: 'hello',
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toBe('systemPrompt is required.');
  });
});
