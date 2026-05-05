const http = require('http');
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
    expect(Array.isArray(data.supportedTools)).toBe(true);
    expect(data.supportedTools.some((tool) => tool.key === 'BufferTool')).toBe(true);
  });

  test('POST /api/run returns validation error for unsupported tools', async () => {
    const response = await requestJson(baseUrl, '/api/run', {
      method: 'POST',
      body: { tool: 'AddDataTool', params: {}, state: {} },
    });
    const data = response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.details.supportedTools).toContain('BufferTool');
  });
});
