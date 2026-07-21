const express = require('express');
const cors = require('cors');
const fetch = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));
const path = require('path');
const {
  AI_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  KNOWN_OLLAMA_MODELS,
  SYSTEM_PROMPT,
} = require('./js/ai-providers');
const { requestStructuredData } = require('./js/ai/requestStructuredData');
const { getHeadlessToolCatalog, runHeadlessTool } = require('./js/headless-runtime');
const { runToolHeadlessly } = require('./js/runtime/headlessRunner');
const MAX_AI_TOKENS = 4096;

let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (_error) {
  rateLimit = () => (_req, _res, next) => next();
}

const app = express();
require('dotenv').config();

app.use(express.json());

function countGeojsonFeatures(geojson) {
  if (!geojson || typeof geojson !== 'object') return 0;
  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features) ? geojson.features.length : 0;
  }
  if (geojson.type === 'Feature') return 1;
  if (typeof geojson.type === 'string') return 1;
  return 0;
}

function getLayerFeatureCount(state, layerId) {
  const layer = Array.isArray(state?.layers) ? state.layers.find((entry) => entry.id === layerId) : null;
  return countGeojsonFeatures(layer?.geojson);
}

function collectInputLayerIds(toolKey, params = {}) {
  const ids = [];

  if (typeof params['Input Layer'] === 'string' && params['Input Layer']) {
    ids.push(params['Input Layer']);
  }
  if (typeof params.Layer === 'string' && params.Layer) {
    ids.push(params.Layer);
  }
  if (toolKey === 'RandomPointsTool' && params['Inside Polygon'] && typeof params.Polygon === 'string' && params.Polygon) {
    ids.push(params.Polygon);
  }

  return [...new Set(ids)];
}

function buildExecutionReceipt({ toolKey, params, requestState, result, startedAt, finishedAt }) {
  const inputLayerIds = collectInputLayerIds(toolKey, params);
  const outputLayerIds = Array.isArray(result?.state?.added)
    ? result.state.added.map((layer) => layer.id).filter(Boolean)
    : [];

  let inputFeatureCount = inputLayerIds.reduce((sum, layerId) => sum + getLayerFeatureCount(requestState, layerId), 0);
  if (!inputFeatureCount && requestState?.featureCollection) {
    inputFeatureCount = countGeojsonFeatures(requestState.featureCollection);
  }

  let outputFeatureCount = outputLayerIds.reduce((sum, layerId) => sum + getLayerFeatureCount(result?.state, layerId), 0);
  if (!outputFeatureCount && result?.state?.featureCollection) {
    outputFeatureCount = countGeojsonFeatures(result.state.featureCollection);
  }
  if (!outputFeatureCount && result?.output?.download?.data) {
    try {
      outputFeatureCount = countGeojsonFeatures(JSON.parse(result.output.download.data));
    } catch (_error) {
      outputFeatureCount = 0;
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    inputLayerIds,
    outputLayerIds,
    featureCounts: {
      input: inputFeatureCount,
      output: outputFeatureCount,
    },
  };
}

function normalizeOllamaUrl(value) {
  const base = (value || DEFAULT_OLLAMA_URL).trim() || DEFAULT_OLLAMA_URL;
  return base.replace(/\/+$/, '');
}

function getConfiguredOllamaUrl() {
  return normalizeOllamaUrl(process.env.OLLAMA_BASE_URL || AI_PROVIDERS.ollama.defaultUrl || DEFAULT_OLLAMA_URL);
}

async function getOllamaModels(baseUrl = getConfiguredOllamaUrl()) {
  const normalizedUrl = normalizeOllamaUrl(baseUrl);
  const fallbackIds = [];
  const seenFallback = new Set();
  [DEFAULT_OLLAMA_MODEL, ...(AI_PROVIDERS.ollama.fallbackModels || KNOWN_OLLAMA_MODELS)].forEach((modelId) => {
    if (!modelId || seenFallback.has(modelId)) return;
    seenFallback.add(modelId);
    fallbackIds.push(modelId);
  });

  try {
    const response = await fetch(`${normalizedUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama tags request failed (${response.status})`);
    }

    const payload = await response.json();
    const runtimeModels = Array.isArray(payload?.models)
      ? payload.models
          .map((model) => model?.name || model?.model)
          .filter(Boolean)
      : [];

    const orderedIds = [];
    const seen = new Set();
    [DEFAULT_OLLAMA_MODEL, ...runtimeModels, ...fallbackIds].forEach((modelId) => {
      if (!modelId || seen.has(modelId)) return;
      seen.add(modelId);
      orderedIds.push(modelId);
    });

    return {
      ok: true,
      source: 'runtime',
      defaultModel: orderedIds.includes(DEFAULT_OLLAMA_MODEL) ? DEFAULT_OLLAMA_MODEL : (orderedIds[0] || DEFAULT_OLLAMA_MODEL),
      models: orderedIds.map((modelId) => ({ id: modelId, label: modelId })),
    };
  } catch (error) {
    return {
      ok: false,
      source: 'fallback',
      defaultModel: DEFAULT_OLLAMA_MODEL,
      models: fallbackIds.map((modelId) => ({ id: modelId, label: modelId })),
      error: error.message,
    };
  }
}

function parseModelJson(content) {
  if (content == null) {
    throw new Error('Model response was empty');
  }

  const text = String(content).trim();
  if (!text) {
    throw new Error('Model response was empty');
  }

  const directAttempt = [text];
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    directAttempt.unshift(fenced[1].trim());
  }

  for (const candidate of directAttempt) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // keep trying other extraction strategies
    }
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const objectSlice = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(objectSlice);
    } catch (_error) {
      // continue to array extraction
    }
  }

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const arraySlice = text.slice(firstBracket, lastBracket + 1);
    return JSON.parse(arraySlice);
  }

  throw new Error('Model response did not contain valid JSON');
}

// CORS — restrict to known origins in production
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(
    cors({
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
} else {
  // Open CORS for local development
  app.use(cors());
}

// Serve the project root so index.html and /public assets are both reachable.
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/headless-demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'headless-demo.html'));
});

const toolSpecs = require('./js/tools/specs.json');

app.get('/api/tools', (_req, res) => {
  res.json({ ok: true, tools: toolSpecs });
});

app.get('/api/run', (_req, res) => {
  res.json({
    ok: true,
    method: 'POST',
    supportedTools: getHeadlessToolCatalog(),
    notes: [
      'First pass: headless execution is currently limited to tools that are safe without the browser UI.',
      'Send request state.layers with stable ids and GeoJSON so params can reference them.',
      'Layer-state tools use state.layers; featureCollection tools use state.featureCollection.',
      'Tool validation failures return HTTP 200 with ok: false; unsupported tools and malformed API requests return 4xx.',
    ],
    requestShape: {
      tool: 'BufferTool',
      params: {
        'Input Layer': 'source-layer',
        Distance: 5,
        Units: 'miles',
      },
      state: {
        layers: [
          {
            id: 'source-layer',
            name: 'Source Layer',
            geojson: { type: 'FeatureCollection', features: [] },
          },
        ],
        bbox: [-118.5, 33.5, -117.5, 34.5],
      },
    },
  });
});

app.post('/api/run', async (req, res) => {
  try {
    const body = req.body || {};
    const startedAt = new Date();
    const result = body?.state?.featureCollection
      ? await runToolHeadlessly({
          toolKey: body.tool,
          params: body.params,
          state: body.state,
        })
      : await runHeadlessTool(body);
    const finishedAt = new Date();

    res.json({
      ...result,
      execution: buildExecutionReceipt({
        toolKey: body.tool,
        params: body.params,
        requestState: body.state,
        result,
        startedAt,
        finishedAt,
      }),
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      ok: false,
      error: error.message || 'Failed to run tool',
      ...(error.details ? { details: error.details } : {}),
    });
  }
});

app.post('/api/ai_structured', async (req, res) => {
  try {
    const {
      systemPrompt,
      userPrompt,
      model = 'gpt-4o',
      provider: requestedProvider,
      ollamaUrl: requestedOllamaUrl,
      temperature = 0.2,
      maxTokens = 1200,
    } = req.body || {};

    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      return res.status(400).json({ ok: false, error: 'systemPrompt is required.' });
    }
    if (typeof userPrompt !== 'string' || !userPrompt.trim()) {
      return res.status(400).json({ ok: false, error: 'userPrompt is required.' });
    }
    if (typeof model !== 'string' || !model.trim()) {
      return res.status(400).json({ ok: false, error: 'model must be a non-empty string.' });
    }

    const parsedTemperature = Number(temperature);
    if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
      return res.status(400).json({ ok: false, error: 'temperature must be a number between 0 and 2.' });
    }

    const parsedMaxTokens = Number(maxTokens);
    const isInteger = Number.isFinite(parsedMaxTokens) && Math.floor(parsedMaxTokens) === parsedMaxTokens;
    if (!isInteger || parsedMaxTokens < 1 || parsedMaxTokens > MAX_AI_TOKENS) {
      return res.status(400).json({ ok: false, error: `maxTokens must be an integer between 1 and ${MAX_AI_TOKENS}.` });
    }

    const providerId = requestedProvider || DEFAULT_PROVIDER;
    const provider = AI_PROVIDERS[providerId];
    if (!provider) {
      return res.status(400).json({ ok: false, error: `Unknown provider: ${providerId}` });
    }

    const authHeader = req.get('Authorization');
    const userKey = authHeader ? authHeader.replace('Bearer ', '').trim() : null;
    const envKey = process.env.OPENAI_API_KEY;
    const apiKey = userKey || envKey;

    if (provider.requiresKey && !apiKey) {
      return res.status(400).json({ ok: false, error: `No API key provided for ${provider.name}.` });
    }

    let endpoint = provider.endpoint;
    if (providerId === 'ollama') {
      endpoint = `${normalizeOllamaUrl(requestedOllamaUrl || getConfiguredOllamaUrl())}/v1/chat/completions`;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || provider.defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: parsedMaxTokens,
        temperature: parsedTemperature,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `${provider.name} request failed (${response.status})${body ? `: ${body}` : ''}` });
    }

    const data = await response.json();
    return res.status(200).json(parseModelJson(data?.choices?.[0]?.message?.content));
  } catch (error) {
    console.error('Error fetching structured AI data:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to connect to AI provider' });
  }
});

// Expose available providers so the frontend can build its settings UI.
app.get('/api/providers', async (_req, res) => {
  const ollamaModels = await getOllamaModels();
  const providers = Object.values(AI_PROVIDERS).map((provider) => {
    if (provider.id === 'ollama') {
      return {
        id: provider.id,
        name: provider.name,
        defaultModel: ollamaModels.defaultModel,
        requiresKey: provider.requiresKey,
        description: provider.description,
        defaultUrl: getConfiguredOllamaUrl(),
        models: ollamaModels.models,
        modelSource: ollamaModels.source,
      };
    }

    return {
      id: provider.id,
      name: provider.name,
      defaultModel: provider.defaultModel,
      requiresKey: provider.requiresKey,
      description: provider.description,
      models: [],
    };
  });

  res.json({ ok: true, providers, default: DEFAULT_PROVIDER });
});

// Rate-limit the AI endpoint
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — try again in a minute.' },
});

app.post('/api/ai_geojson', aiLimiter, async (req, res) => {
  const { prompt, provider: requestedProvider, model: requestedModel } = req.body;

  // Resolve provider
  const providerId = requestedProvider || DEFAULT_PROVIDER;
  const provider = AI_PROVIDERS[providerId];
  if (!provider) {
    return res.status(400).json({ error: `Unknown provider: ${providerId}` });
  }

  // Resolve API key: prefer per-request key, fall back to env var
  const authHeader = req.get('Authorization');
  const userKey = authHeader ? authHeader.replace('Bearer ', '').trim() : null;
  const envKey = process.env.OPENAI_API_KEY;
  const apiKey = userKey || envKey;

  if (provider.requiresKey && !apiKey) {
    return res.status(400).json({
      error: 'No API key provided. Add one in AI Settings or set OPENAI_API_KEY on the server.',
    });
  }

  // Resolve endpoint — for Ollama, allow user to override the URL
  let endpoint = provider.endpoint;
  if (providerId === 'ollama') {
    endpoint = `${normalizeOllamaUrl(req.body.ollamaUrl || getConfiguredOllamaUrl())}/v1/chat/completions`;
  }

  const model = requestedModel || provider.defaultModel;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 1024,
    temperature: 0.5,
  };

  // Request structured JSON output from providers that support OpenAI-style response_format.
  if (providerId === 'openai' || providerId === 'ollama') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`${provider.name} returned ${response.status}:`, errBody);
      return res.status(502).json({ error: `${provider.name} request failed (${response.status})` });
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const geoJSON = parseModelJson(content);
    return res.status(200).json(geoJSON);
  } catch (error) {
    console.error(`Error fetching from ${provider.name}:`, error);
    return res.status(500).json({ error: `Failed to connect to ${provider.name}` });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = {
  app,
  getConfiguredOllamaUrl,
  getOllamaModels,
  normalizeOllamaUrl,
  parseModelJson,
};
