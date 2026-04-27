const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult, getLayer } = require('../state');
const { STORAGE_KEYS, DEFAULT_PROVIDER } = require('../ai-providers');

/**
 * A tool for generating AI features.
 * Calls an AI provider (OpenAI or Ollama) to interpret the user prompt.
 * Draws the returned GeoJSON features on the map.
 */
class GenerateAIFeatures extends Tool {

    constructor() {    
        super("Generate AI Features", [
            new Parameter("Prompt","The prompt to generate AI features","text","")  
        ]);
    }

    _getApiBase() {
        return (typeof window !== 'undefined' && window.__SWB_API_BASE__) || '';
    }

    _getSettings() {
        if (typeof localStorage === 'undefined') return {};
        return {
            provider: localStorage.getItem(STORAGE_KEYS.provider) || DEFAULT_PROVIDER,
            apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || '',
            ollamaUrl: localStorage.getItem(STORAGE_KEYS.ollamaUrl) || '',
            model: localStorage.getItem(STORAGE_KEYS.model) || '',
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
            for (const id of (res.added || [])) {
                const addedLayer = getLayer(id);
                if (!addedLayer || !addedLayer.feature || !addedLayer.feature.properties) continue;

                const attributes = addedLayer.feature.properties;
                let popupContent = "<table class='popupTable'>";
                for (let key in attributes) {
                    popupContent += `<tr><td><b>${key.charAt(0).toUpperCase() + key.slice(1)}</b></td><td>${attributes[key]}</td></tr>`;
                }
                popupContent += "</table>";
                if (typeof addedLayer.bindPopup === 'function') {
                    addedLayer.bindPopup(popupContent);
                }
            }
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