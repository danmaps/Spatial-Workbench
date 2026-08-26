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
const { requestProviderResponse, ProviderRequestError } = require('./js/ai/providerClient');
const { recordUsageTelemetry } = require('./js/ai/usageTelemetry');
const { getHeadlessToolCatalog, runHeadlessTool } = require('./js/headless-runtime');
const { runToolHeadlessly } = require('./js/runtime/headlessRunner');
const { runToolInWorker, getActiveWorkerCount } = require('./js/runtime/workerExecutor');
const { createSpatialSession, normalizeSpatialRequest, SPATIAL_METADATA } = require('./js/spatial');
const { createInMemoryDatasetStore, formatDatasetRef, parseDatasetRef } = require('./js/runtime/datasetStore');
const MAX_AI_TOKENS = 4096;
const DEFAULT_AI_TIMEOUT_MS = 30000;
const DEFAULT_AI_MAX_RETRIES = 2;
const DEFAULT_DATASET_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Workload guardrail defaults — all overridable via environment variables
// ---------------------------------------------------------------------------
const DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_LAYERS = 20;
const DEFAULT_MAX_FEATURES = 50000;
const DEFAULT_MAX_VERTICES = 2000000;
const DEFAULT_TOOL_TIMEOUT_MS = 30000; // 30 s
const DEFAULT_MAX_CONCURRENT_RUNS = 10;
const DEFAULT_API_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_API_RUN_RATE_LIMIT_MAX = 60;
// Tool-specific parameter bounds
const DEFAULT_MAX_RANDOM_POINTS = 10000;
const DEFAULT_MAX_BUFFER_DISTANCE = 500; // in the requested units

function getEnvInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function getAiRequestOptions() {
  return {
    timeoutMs: getEnvInt('AI_REQUEST_TIMEOUT_MS', DEFAULT_AI_TIMEOUT_MS),
    maxRetries: getEnvInt('AI_MAX_RETRIES', DEFAULT_AI_MAX_RETRIES),
  };
}

function getProviderApiKey(providerId, requestKey) {
  if (requestKey) return requestKey;
  if (providerId === 'openrouter') return process.env.OPENROUTER_API_KEY || '';
  return process.env.OPENAI_API_KEY || '';
}

function getOpenRouterFallbackModels() {
  return String(process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((modelId) => modelId.trim())
    .filter(Boolean);
}

function recordProviderUsage({ normalized, error, provider, model, startedAt }) {
  return recordUsageTelemetry({
    provider: normalized?.provider || provider,
    model: normalized?.model || model,
    inputTokens: normalized?.inputTokens,
    outputTokens: normalized?.outputTokens,
    reportedCost: normalized?.reportedCost,
    reportedCostUnit: normalized?.reportedCostUnit,
    latencyMs: normalized?.latencyMs || error?.latencyMs || (startedAt ? Date.now() - startedAt : null),
    success: Boolean(normalized),
    errorCategory: error?.category,
    requestId: normalized?.requestId,
  });
}

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

const maxRequestBytes = getEnvInt('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES);

// Rate-limit the spatial run endpoint. Mounted before the body parser so that
// throttled callers are rejected before the payload is parsed or executed.
const apiRunLimiter = rateLimit
  ? rateLimit({
    windowMs: getEnvInt('API_RUN_RATE_LIMIT_WINDOW_MS', DEFAULT_API_RUN_RATE_LIMIT_WINDOW_MS),
    max: getEnvInt('API_RUN_RATE_LIMIT_MAX', DEFAULT_API_RUN_RATE_LIMIT_MAX),
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many spatial requests — try again shortly.', code: 'RATE_LIMIT' },
  })
  : (req, res, next) => next();

app.use('/api/run', (req, res, next) => (
  req.method === 'POST' ? apiRunLimiter(req, res, next) : next()
));

app.use(express.json({ limit: maxRequestBytes }));

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

function countGeojsonVertices(geojson) {
  if (!geojson || typeof geojson !== 'object') return 0;
  let total = 0;

  function countCoords(coords) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      total += 1;
    } else {
      coords.forEach(countCoords);
    }
  }

  function countGeometry(geometry) {
    if (!geometry) return;
    if (geometry.type === 'GeometryCollection') {
      (geometry.geometries || []).forEach(countGeometry);
    } else if (geometry.coordinates) {
      countCoords(geometry.coordinates);
    }
  }

  if (geojson.type === 'FeatureCollection') {
    (geojson.features || []).forEach((f) => countGeometry(f?.geometry));
  } else if (geojson.type === 'Feature') {
    countGeometry(geojson.geometry);
  } else {
    countGeometry(geojson);
  }

  return total;
}

function countLayersVertices(layers) {
  return (layers || []).reduce((sum, layer) => sum + countGeojsonVertices(layer?.geojson), 0);
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
  if (!Array.isArray(state.layers)) {
    return { state, resolvedInputs };
  }

  state.layers = state.layers.map((layer, index) => {
    if (!layer || typeof layer !== 'object' || typeof layer.datasetRef !== 'string') return layer;

    const resolved = datasetStore.resolveDatasetReference({
      datasetRef: layer.datasetRef,
      ownerId,
    });
    const layerId = layer.id || `layer-${index + 1}`;
    resolvedInputs.push({ layerId, datasetRef: resolved.datasetRef });
    return {
      ...layer,
      geojson: resolved.geojson,
      id: layerId,
    };
  });

  return { state, resolvedInputs };
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
          ttlMs: datasetTtlMs,
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

app.get('/api/state', (_req, res) => {
  const catalog = getHeadlessToolCatalog();
  res.json({
    ok: true,
    sessionModel: 'request-scoped',
    headless: {
      supportedToolCount: catalog.length,
      supportedToolKeys: catalog.map((t) => t.key),
    },
    spatial: {
      ...SPATIAL_METADATA,
      warnings: [],
    },
    uptime: process.uptime(),
    rateLimiting: rateLimit !== null && typeof rateLimit === 'function',
    timestamp: new Date().toISOString(),
    workloadLimits: {
      maxRequestBytes,
      maxLayers: getEnvInt('MAX_LAYERS', DEFAULT_MAX_LAYERS),
      maxFeatures: getEnvInt('MAX_FEATURES', DEFAULT_MAX_FEATURES),
      maxVertices: getEnvInt('MAX_VERTICES', DEFAULT_MAX_VERTICES),
      toolTimeoutMs: getEnvInt('TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS),
      maxConcurrentRuns: getEnvInt('MAX_CONCURRENT_RUNS', DEFAULT_MAX_CONCURRENT_RUNS),
      maxRandomPoints: getEnvInt('MAX_RANDOM_POINTS', DEFAULT_MAX_RANDOM_POINTS),
      maxBufferDistance: getEnvInt('MAX_BUFFER_DISTANCE', DEFAULT_MAX_BUFFER_DISTANCE),
    },
    limitConfiguration: {
      // Read per request, so changes take effect without a restart.
      dynamic: [
        'MAX_LAYERS',
        'MAX_FEATURES',
        'MAX_VERTICES',
        'TOOL_TIMEOUT_MS',
        'MAX_CONCURRENT_RUNS',
        'MAX_RANDOM_POINTS',
        'MAX_BUFFER_DISTANCE',
      ],
      // Bound to middleware constructed at startup; a restart is required.
      startupOnly: [
        'MAX_REQUEST_BYTES',
        'API_RUN_RATE_LIMIT_MAX',
        'API_RUN_RATE_LIMIT_WINDOW_MS',
      ],
    },
    execution: {
      isolation: 'worker-thread',
      activeRuns: getActiveWorkerCount(),
    },
    notes: [
      'Execution is request-scoped. No server-side session state is persisted between calls.',
      'Pass state into POST /api/run and receive the updated state back in the response.',
      'Use /api/datasets to register large GeoJSON payloads and reference them by handle across calls.',
      'POST /api/run executes in a worker thread that is terminated when TOOL_TIMEOUT_MS elapses.',
      'workloadLimits values listed in limitConfiguration.dynamic are re-read per request; startupOnly values require a restart.',
    ],
  });
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
      ttlMs,
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

app.post('/api/datasets/cleanup', (req, res) => {
  const expectedToken = process.env.DATASET_CLEANUP_TOKEN;
  if (expectedToken) {
    const token = req.get('x-dataset-cleanup-token');
    if (token !== expectedToken) {
      return res.status(403).json({
        ok: false,
        error: 'Invalid cleanup token.',
      });
    }
  }
  const expired = datasetStore.cleanupExpiredDatasets();
  res.json({
    ok: true,
    expired,
    removedCount: expired.length,
  });
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
    // -----------------------------------------------------------------------
    // Workload guardrails
    // -----------------------------------------------------------------------
    const maxLayers = getEnvInt('MAX_LAYERS', DEFAULT_MAX_LAYERS);
    const maxFeatures = getEnvInt('MAX_FEATURES', DEFAULT_MAX_FEATURES);
    const maxVertices = getEnvInt('MAX_VERTICES', DEFAULT_MAX_VERTICES);
    const toolTimeoutMs = getEnvInt('TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS);
    const maxConcurrentRuns = getEnvInt('MAX_CONCURRENT_RUNS', DEFAULT_MAX_CONCURRENT_RUNS);

    if (getActiveWorkerCount() >= maxConcurrentRuns) {
      return res.status(503).json({
        ok: false,
        error: 'Server capacity reached. Too many concurrent spatial requests — try again shortly.',
        code: 'CONCURRENCY_LIMIT',
        limit: maxConcurrentRuns,
      });
    }

    const body = req.body || {};

    const requestLayers = Array.isArray(body.state?.layers) ? body.state.layers : [];
    if (requestLayers.length > maxLayers) {
      return res.status(422).json({
        ok: false,
        error: `Request exceeds the maximum allowed layer count of ${maxLayers}.`,
        code: 'LAYER_LIMIT',
        limit: maxLayers,
        received: requestLayers.length,
      });
    }

    // Tool-specific parameter bounds — checked before any expensive work
    const toolKey = body.tool;
    if (toolKey === 'RandomPointsTool') {
      const maxRandomPoints = getEnvInt('MAX_RANDOM_POINTS', DEFAULT_MAX_RANDOM_POINTS);
      const requestedCount = parseInt(body.params?.['Points Count'], 10);
      if (requestedCount > maxRandomPoints) {
        return res.status(422).json({
          ok: false,
          error: `RandomPointsTool: "Points Count" (${requestedCount}) exceeds the maximum of ${maxRandomPoints}.`,
          code: 'PARAM_LIMIT',
          param: 'Points Count',
          limit: maxRandomPoints,
          received: requestedCount,
        });
      }
    }
    if (toolKey === 'BufferTool') {
      const maxBufferDistance = getEnvInt('MAX_BUFFER_DISTANCE', DEFAULT_MAX_BUFFER_DISTANCE);
      const requestedDistance = parseFloat(body.params?.['Distance']);
      if (Number.isFinite(requestedDistance) && Math.abs(requestedDistance) > maxBufferDistance) {
        return res.status(422).json({
          ok: false,
          error: `BufferTool: "Distance" (${requestedDistance}) exceeds the maximum absolute value of ${maxBufferDistance}.`,
          code: 'PARAM_LIMIT',
          param: 'Distance',
          limit: maxBufferDistance,
          received: requestedDistance,
        });
      }
    }

    // -----------------------------------------------------------------------

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
    try {
      const resolved = resolveDatasetStateReferences(body.state, ownerId);
      resolvedState = resolved.state;
      resolvedDatasetInputs = resolved.resolvedInputs;
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Failed to resolve dataset references.',
        ...(error.details ? { details: error.details } : {}),
      });
    }

    // Feature and vertex limits are enforced after dataset-reference resolution
    // so that stored GeoJSON and featureCollection-mode state are both counted.
    const resolvedLayers = Array.isArray(resolvedState?.layers) ? resolvedState.layers : [];
    const totalFeatures =
      resolvedLayers.reduce((sum, l) => sum + countGeojsonFeatures(l?.geojson), 0) +
      countGeojsonFeatures(resolvedState?.featureCollection);
    if (totalFeatures > maxFeatures) {
      return res.status(422).json({
        ok: false,
        error: `Request exceeds the maximum allowed feature count of ${maxFeatures}.`,
        code: 'FEATURE_LIMIT',
        limit: maxFeatures,
        received: totalFeatures,
      });
    }

    const totalVertices =
      countLayersVertices(resolvedLayers) +
      countGeojsonVertices(resolvedState?.featureCollection);
    if (totalVertices > maxVertices) {
      return res.status(422).json({
        ok: false,
        error: `Request exceeds the maximum allowed vertex/coordinate count of ${maxVertices}.`,
        code: 'VERTEX_LIMIT',
        limit: maxVertices,
        received: totalVertices,
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
    // Execution runs in a worker thread so the deadline is enforceable: on
    // timeout the worker is terminated, which stops synchronous geometry work
    // instead of leaving it blocking the process. Concurrency is accounted by
    // live workers, released exactly once when the thread exits.
    const execution = await runToolInWorker({
      toolKey: body.tool,
      params: body.params,
      state: spatialRequest.state,
      spatialWarnings: spatial.getWarnings(),
      timeoutMs: toolTimeoutMs,
      maxConcurrentRuns,
    });
    const rawResult = execution.result;
    spatial.addWarnings(execution.spatialWarnings);
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
    const toolInputLayerIds = new Set(collectInputLayerIds(body.tool, body.params));
    const readDatasetHandles = resolvedDatasetInputs
      .filter((entry) => toolInputLayerIds.size === 0 || toolInputLayerIds.has(entry.layerId))
      .map((entry) => entry.datasetRef)
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
          read: [...new Set(readDatasetHandles)],
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
      ...(error.code ? { code: error.code } : {}),
      ...(error.limit !== undefined ? { limit: error.limit } : {}),
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
    const apiKey = getProviderApiKey(providerId, userKey);

    if (provider.requiresKey && !apiKey) {
      return res.status(400).json({ ok: false, error: `No API key provided for ${provider.name}.` });
    }

    let endpoint = provider.endpoint;
    if (providerId === 'ollama') {
      endpoint = `${normalizeOllamaUrl(requestedOllamaUrl || getConfiguredOllamaUrl())}/v1/chat/completions`;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const startedAt = Date.now();

    const normalized = await requestProviderResponse({
      fetchImpl: fetch,
      endpoint,
      headers,
      body: {
        model: model || provider.defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: parsedMaxTokens,
        temperature: parsedTemperature,
        response_format: { type: 'json_object' },
        ...(providerId === 'openrouter' && getOpenRouterFallbackModels().length > 0
          ? { models: getOpenRouterFallbackModels(), route: 'fallback' }
          : {}),
      },
      provider: provider.name,
      model: model || provider.defaultModel,
      ...getAiRequestOptions(),
    });
    const parsed = parseModelJson(normalized.content);
    recordProviderUsage({ normalized, provider: provider.name, model: model || provider.defaultModel, startedAt });
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Error fetching structured AI data:', error);
    recordProviderUsage({ error, provider: provider.name, model: model || provider.defaultModel, startedAt });
    const statusCode = error instanceof ProviderRequestError && error.status >= 400 && error.status < 500 ? error.status : 502;
    return res.status(statusCode).json({
      ok: false,
      error: error.message || 'Failed to connect to AI provider',
      ...(error.category ? { category: error.category } : {}),
      ...(error.provider ? { provider: error.provider } : {}),
      ...(error.model ? { model: error.model } : {}),
    });
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
  const apiKey = getProviderApiKey(providerId, userKey);

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
  if (providerId === 'openrouter') {
    body.response_format = { type: 'json_object' };
    const fallbackModels = getOpenRouterFallbackModels();
    if (fallbackModels.length > 0) {
      body.models = fallbackModels;
      body.route = 'fallback';
    }
  }

  const startedAt = Date.now();
  try {
    const normalized = await requestProviderResponse({
      fetchImpl: fetch,
      endpoint,
      headers,
      body,
      provider: provider.name,
      model,
      ...getAiRequestOptions(),
    });
    const geoJSON = parseModelJson(normalized.content);
    recordProviderUsage({ normalized, provider: provider.name, model, startedAt });
    return res.status(200).json(geoJSON);
  } catch (error) {
    console.error(`Error fetching from ${provider.name}:`, error);
    recordProviderUsage({ error, provider: provider.name, model, startedAt });
    const statusCode = error instanceof ProviderRequestError && error.status >= 400 && error.status < 500 ? error.status : 502;
    return res.status(statusCode).json({
      error: error.message || `Failed to connect to ${provider.name}`,
      ...(error.category ? { category: error.category } : {}),
      ...(error.provider ? { provider: error.provider } : {}),
      ...(error.model ? { model: error.model } : {}),
    });
  }
});

const PORT = process.env.PORT || 3000;

// Handle payload-too-large errors from express.json with a structured response
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      ok: false,
      error: `Request payload exceeds the maximum allowed size of ${getEnvInt('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES)} bytes.`,
      code: 'PAYLOAD_TOO_LARGE',
      limit: getEnvInt('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES),
    });
  }
  next(err);
});

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
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_LAYERS,
  DEFAULT_MAX_FEATURES,
  DEFAULT_MAX_VERTICES,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_MAX_RANDOM_POINTS,
  DEFAULT_MAX_BUFFER_DISTANCE,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_AI_MAX_RETRIES,
};
