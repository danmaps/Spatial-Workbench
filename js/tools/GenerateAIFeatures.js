const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult } = require('../state');
const { STORAGE_KEYS, DEFAULT_PROVIDER, AI_PROVIDERS } = require('../ai-providers');

/**
 * A tool for generating AI features.
 * Calls an AI provider (OpenAI or Ollama) to interpret the user prompt.
 * Draws the returned GeoJSON features on the map.
 */
class GenerateAIFeatures extends Tool {

    constructor() {    
        super("Generate AI Features", [
            new Parameter("Prompt","The prompt to generate AI features","text","", null, null, null, true)  
        ]);
        this.description = "Generates GeoJSON map features from a natural-language prompt using the AI provider and model configured in Settings.";
        this.notes = [
            "Model selection follows your saved Settings panel configuration (stored in localStorage under SWB_AI_PROVIDER and SWB_AI_MODEL).",
            "If you specify a custom Model in Settings, Generate AI Features uses that exact model.",
            "If no custom Model is set, it falls back to the active provider's default model: OpenRouter (default provider) -> openai/gpt-4o, OpenAI -> gpt-4o, Built-in AI (Ollama) -> qwen2.5-coder:1.5b (or the local model selected in Settings).",
            "OpenRouter and OpenAI use your client-side API key (SWB_API_KEY) when provided, or the server's configured key if enabled; Built-in AI (Ollama) requires no API key.",
        ];
    }

    _getApiBase() {
        return (typeof window !== 'undefined' && window.__SWB_API_BASE__) || '';
    }

    _getSettings() {
        if (typeof localStorage === 'undefined') return {};
        const provider = localStorage.getItem(STORAGE_KEYS.provider) || DEFAULT_PROVIDER;
        return {
            provider,
            apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || '',
            ollamaUrl: localStorage.getItem(STORAGE_KEYS.ollamaUrl) || '',
            model: localStorage.getItem(STORAGE_KEYS.model) || AI_PROVIDERS[provider]?.defaultModel || '',
        };
    }

    async run(params) {
        const prompt = params['Prompt'];
        const settings = this._getSettings();
        const apiBase = this._getApiBase();

        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }

        const body = { prompt };
        if (settings.provider) body.provider = settings.provider;
        if (settings.model) body.model = settings.model;
        if (settings.ollamaUrl) body.ollamaUrl = settings.ollamaUrl;

        const response = await fetch(`${apiBase}/api/ai_geojson`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `AI request failed with status ${response.status}`);
        }

        const data = await response.json();
        data.toolMetadata = {
            name: this.name,
            params,
            provider: settings.provider || DEFAULT_PROVIDER,
            timestamp: new Date().toISOString()
        };

        const res = applyResult({ addGeojson: data });

        if (res && res.ok) {
            this.setStatus(0, 'AI features added to map.');
            return res;
        }

        this.setStatus(2, 'Failed to add AI features to map.');
    }
    
    
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GenerateAIFeatures };
} else {
    window.GenerateAIFeatures = GenerateAIFeatures;
}
