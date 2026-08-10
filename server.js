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
const { createSpatialSession, normalizeSpatialRequest, SPATIAL_METADATA } = require('./js/spatial');
const { createInMemoryDatasetStore, formatDatasetRef, parseDatasetRef } = require('./js/runtime/datasetStore');
const MAX_AI_TOKENS = 4096;
const DEFAULT_DATASET_TTL_MS = 15 * 60 * 1000;

let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (_error) {
  rateLimit = () => (_req, _res, next) => next();
}

const app = express();
require('dotenv').config();
const datasetStore = createInMemoryDatasetStore({
  defaultTtlMs: Number(process.env.DATASET_TTL_MS) > 0 ? Number(process.env.DATASET_TTL_MS) : DEFAULT_DATASET_TTL_MS,
});

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

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getDatasetOwnerId(req) {
  const ownerId = req.get('x-workbench-owner');
  return typeof ownerId === 'string' && ownerId.trim() ? ownerId.trim() : 'anonymous';
}

function getDatasetTtlMs(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  const ttlMs = Number(rawValue);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
  return ttlMs;
}

function resolveDatasetStateReferences(rawState, ownerId) {
  const state = deepClone(rawState || {});
  const resolvedInputs = [];
  const requestLayerRefsById = {};
  if (!Array.isArray(state.layers)) {
    return { state, resolvedInputs, requestLayerRefsById };
  }

  state.layers = state.layers.map((layer, index) => {
    if (!layer || typeof layer !== 'object' || typeof layer.datasetRef !== 'string') return layer;

    const resolved = datasetStore.resolveDatasetReference({
      datasetRef: layer.datasetRef,
      ownerId,
    });
    const layerId = layer.id || `layer-${index + 1}`;
    const canonicalRef = resolved.datasetRef;
    requestLayerRefsById[layerId] = canonicalRef;
    resolvedInputs.push({ layerId, datasetRef: canonicalRef });
    return {
      ...layer,
      geojson: resolved.geojson,
      id: layerId,
    };
  });

  return { state, resolvedInputs, requestLayerRefsById };
}

function buildReferenceResponseState({ requestState, responseState, ownerId, datasetTtlMs }) {
  const requestLayers = Array.isArray(requestState?.layers) ? requestState.layers : [];
  const responseLayers = Array.isArray(responseState?.layers) ? responseState.layers : [];
  const referenceMode = requestLayers.some((layer) => typeof layer?.datasetRef === 'string');
  if (!referenceMode) {
    return {
      state: responseState,
      producedOutputs: [],
    };
  }

  const inputRefsByLayerId = requestLayers.reduce((acc, layer) => {
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || typeof layer.datasetRef !== 'string') return acc;
    const datasetId = parseDatasetRef(layer.datasetRef);
    if (datasetId) {
      acc[layer.id] = formatDatasetRef(datasetId);
    }
    return acc;
  }, {});

  const addedLayerIds = new Set(Array.isArray(responseState?.added) ? responseState.added.map((layer) => layer.id).filter(Boolean) : []);
  const producedOutputs = [];
  const refsByLayerId = {};
  const nextLayers = responseLayers.map((layer) => {
    if (!layer || typeof layer !== 'object') return layer;

    const existingRef = inputRefsByLayerId[layer.id];
    const shouldReuseExistingRef = existingRef && !addedLayerIds.has(layer.id);
    const datasetRef = shouldReuseExistingRef
      ? existingRef
      : datasetStore.registerDataset({
          ownerId,
          geojson: layer.geojson,
          ttlMs: datasetTtlMs || undefined,
          name: layer.name,
        }).datasetRef;

    refsByLayerId[layer.id] = datasetRef;
    if (addedLayerIds.has(layer.id)) {
      producedOutputs.push({ layerId: layer.id, datasetRef });
    }

    return {
      id: layer.id,
      name: layer.name,
      geometryType: layer.geometryType,
      datasetRef,
    };
  });

  const nextAdded = Array.isArray(responseState?.added)
    ? responseState.added.map((layer) => ({
        id: layer.id,
        name: layer.name,
        datasetRef: refsByLayerId[layer.id],
      }))
    : [];

  return {
    state: {
      ...responseState,
      layers: nextLayers,
      added: nextAdded,
    },
    producedOutputs,
  };
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

function buildExecutionReceipt({
  toolKey,
  params,
  requestState,
  result,
  startedAt,
  finishedAt,
  datasetHandles = { read: [], produced: [], expired: [] },
}) {
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
    datasetHandles: {
      read: Array.isArray(datasetHandles.read) ? datasetHandles.read : [],
      produced: Array.isArray(datasetHandles.produced) ? datasetHandles.produced : [],
      expired: Array.isArray(datasetHandles.expired) ? datasetHandles.expired : [],
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

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get(['/workbench-gis', '/workbench-gis/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/headless-demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'headless-demo.html'));
});

// Serve the project root so the HTML shells and /public assets are both reachable.
app.use(express.static(__dirname, { index: false }));

const toolSpecs = require('./js/tools/specs.json');

app.get('/api/tools', (_req, res) => {
  res.json({ ok: true, tools: toolSpecs });
});

app.post('/api/datasets', (req, res) => {
  try {
    const ownerId = getDatasetOwnerId(req);
    const body = req.body || {};
    const normalized = normalizeSpatialRequest({
      toolKey: 'DatasetRegister',
      state: {
        layers: [{ id: body.id || 'dataset', name: body.name || 'Dataset', geojson: body.geojson }],
      },
    });

    if (!normalized.ok) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid dataset GeoJSON.',
        validation: normalized.validation,
      });
    }

    const ttlMs = getDatasetTtlMs(body.ttlMs);
    if (body.ttlMs !== undefined && ttlMs === null) {
      return res.status(400).json({
        ok: false,
        error: 'ttlMs must be a positive number.',
      });
    }

    const dataset = datasetStore.registerDataset({
      ownerId,
      geojson: normalized.state.layers[0].geojson,
      ttlMs: ttlMs || undefined,
      name: body.name || null,
    });

    return res.status(201).json({
      ok: true,
      dataset,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to register dataset.',
      ...(error.details ? { details: error.details } : {}),
    });
  }
});

app.get('/api/datasets/:id', (req, res) => {
  try {
    const ownerId = getDatasetOwnerId(req);
    const includeData = String(req.query.includeData || '').toLowerCase() === 'true';
    const dataset = datasetStore.getDataset({
      datasetRef: formatDatasetRef(req.params.id),
      ownerId,
      includeData,
    });

    return res.json({
      ok: true,
      dataset,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to load dataset.',
      ...(error.details ? { details: error.details } : {}),
    });
  }
});

app.delete('/api/datasets/:id', (req, res) => {
  try {
    const ownerId = getDatasetOwnerId(req);
    const deleted = datasetStore.deleteDataset({
      datasetRef: formatDatasetRef(req.params.id),
      ownerId,
    });

    return res.json({
      ok: true,
      deleted,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to delete dataset.',
      ...(error.details ? { details: error.details } : {}),
    });
  }
});

app.post('/api/datasets/cleanup', (_req, res) => {
  const expired = datasetStore.cleanupExpiredDatasets();
  res.json({
    ok: true,
    expired,
    removedCount: expired.length,
  });
});

app.get('/api/run', (_req, res) => {
  res.json({
    ok: true,
    method: 'POST',
    supportedTools: getHeadlessToolCatalog(),
    spatial: {
      ...SPATIAL_METADATA,
      warnings: [],
    },
    notes: [
      'First pass: headless execution is currently limited to tools that are safe without the browser UI.',
      'Send request state.layers with stable ids and GeoJSON so params can reference them.',
      'Optional dataset references are supported via state.layers[].datasetRef handles created by /api/datasets.',
      'Layer-state tools use state.layers; featureCollection tools use state.featureCollection.',
      'Tool validation failures return HTTP 200 with ok: false; unsupported tools and malformed API requests return 4xx.',
      'GeoJSON coordinates are interpreted as EPSG:4326 longitude/latitude values and are suitable for lightweight web/runtime analysis, not survey-grade measurement.',
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
          {
            id: 'source-layer-ref',
            datasetRef: 'dataset://abc123',
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
    const ownerId = getDatasetOwnerId(req);
    const datasetTtlMs = getDatasetTtlMs(body.datasetTtlMs);
    if (body.datasetTtlMs !== undefined && datasetTtlMs === null) {
      return res.status(400).json({
        ok: false,
        error: 'datasetTtlMs must be a positive number.',
      });
    }

    let resolvedState;
    let resolvedDatasetInputs = [];
    let requestLayerRefsById = {};
    try {
      const resolved = resolveDatasetStateReferences(body.state, ownerId);
      resolvedState = resolved.state;
      resolvedDatasetInputs = resolved.resolvedInputs;
      requestLayerRefsById = resolved.requestLayerRefsById;
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Failed to resolve dataset references.',
        ...(error.details ? { details: error.details } : {}),
      });
    }

    const spatialRequest = normalizeSpatialRequest({
      toolKey: body.tool,
      state: resolvedState,
    });
    const spatial = createSpatialSession(spatialRequest.warnings);

    if (!spatialRequest.ok) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid spatial input.',
        validation: spatialRequest.validation,
        spatial: spatial.toJSON(),
      });
    }

    const startedAt = new Date();
    const rawResult = spatialRequest.state?.featureCollection
      ? await runToolHeadlessly({
          toolKey: body.tool,
          params: body.params,
          state: spatialRequest.state,
          spatial,
        })
      : await runHeadlessTool({
          tool: body.tool,
          params: body.params,
          state: spatialRequest.state,
          spatial,
        });
    const finishedAt = new Date();
    const referenceResponse = buildReferenceResponseState({
      requestState: body.state,
      responseState: rawResult.state,
      ownerId,
      datasetTtlMs,
    });
    const result = {
      ...rawResult,
      state: referenceResponse.state,
    };
    const readDatasetHandles = collectInputLayerIds(body.tool, body.params)
      .map((layerId) => requestLayerRefsById[layerId])
      .filter(Boolean);

    res.json({
      ...result,
      spatial: spatial.toJSON(),
      execution: buildExecutionReceipt({
        toolKey: body.tool,
        params: body.params,
        requestState: spatialRequest.state,
        result: rawResult,
        startedAt,
        finishedAt,
        datasetHandles: {
          read: [...new Set([...resolvedDatasetInputs.map((entry) => entry.datasetRef), ...readDatasetHandles])],
          produced: referenceResponse.producedOutputs,
          expired: [],
        },
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
