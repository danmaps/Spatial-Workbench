const http = require('http');
const https = require('https');

function normalizeHeadlessApiUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function requestJson(baseUrl, requestPath, options = {}) {
  const url = new URL(requestPath, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : null;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: options.method || 'GET',
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
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
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startLocalHeadlessApi() {
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

function createHeadlessApiRuntimeManager(config = {}) {
  const configuredBaseUrl = normalizeHeadlessApiUrl(config.baseUrl || process.env.HEADLESS_API_URL || '');
  let runtimePromise = null;

  async function getRuntime() {
    if (configuredBaseUrl) {
      return {
        baseUrl: configuredBaseUrl,
        async close() {},
      };
    }

    if (!runtimePromise) {
      runtimePromise = startLocalHeadlessApi();
    }

    return runtimePromise;
  }

  async function close() {
    if (!runtimePromise) return;
    const runtime = await runtimePromise;
    runtimePromise = null;
    await runtime.close();
  }

  return {
    getRuntime,
    close,
  };
}

module.exports = {
  createHeadlessApiRuntimeManager,
  normalizeHeadlessApiUrl,
  requestJson,
  startLocalHeadlessApi,
};
