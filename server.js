const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { AI_PROVIDERS, DEFAULT_PROVIDER, SYSTEM_PROMPT } = require('./js/ai-providers');

const app = express();
require('dotenv').config();

app.use(express.json());

// CORS — restrict to known origins in production
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
} else {
  // Open CORS for local development
  app.use(cors());
}

// Serve the project root so index.html and /public assets are both reachable.
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const toolSpecs = require('./js/tools/specs.json');

app.get('/api/tools', (_req, res) => {
    res.json({ ok: true, tools: toolSpecs });
});

// Expose available providers so the frontend can build its settings UI.
app.get('/api/providers', (_req, res) => {
    const providers = Object.values(AI_PROVIDERS).map(p => ({
        id: p.id,
        name: p.name,
        defaultModel: p.defaultModel,
        requiresKey: p.requiresKey,
        description: p.description,
    }));
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
    if (providerId === 'ollama' && req.body.ollamaUrl) {
        endpoint = req.body.ollamaUrl.replace(/\/+$/, '') + '/v1/chat/completions';
    }

    const model = requestedModel || provider.defaultModel;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
        model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.5,
    };

    // OpenAI supports response_format; Ollama may or may not — include it for OpenAI
    if (providerId === 'openai') {
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
        const geoJSON = JSON.parse(content);
        res.status(200).json(geoJSON);
    } catch (error) {
        console.error(`Error fetching from ${provider.name}:`, error);
        res.status(500).json({ error: `Failed to connect to ${provider.name}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
