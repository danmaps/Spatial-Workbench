/**
 * AI Provider registry.
 *
 * Defines the supported LLM providers and their connection details.
 * Used by both the server (proxy) and the frontend (settings UI).
 */

const AI_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    requiresKey: true,
    description: 'OpenAI API (requires API key)',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.2',
    requiresKey: false,
    description: 'Local Ollama instance — no API key needed',
  },
};

const DEFAULT_PROVIDER = 'ollama';

const SYSTEM_PROMPT =
  'You are a helpful assistant that always only returns valid GeoJSON in response to user queries. ' +
  "Don't use too many vertices. Include somewhat detailed geometry and any attributes you think might be relevant. " +
  'Include factual information. If you want to communicate text to the user, you may use a message property in the attributes of geometry objects. ' +
  'For compatibility with ArcGIS Pro, avoid multiple geometry types in the GeoJSON output. ' +
  "For example, don't mix points and polygons.";

// Settings keys used in localStorage on the client side.
const STORAGE_KEYS = {
  provider: 'SWB_AI_PROVIDER',
  apiKey: 'SWB_API_KEY',
  ollamaUrl: 'SWB_OLLAMA_URL',
  model: 'SWB_AI_MODEL',
};

// CommonJS + browser dual export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AI_PROVIDERS, DEFAULT_PROVIDER, SYSTEM_PROMPT, STORAGE_KEYS };
} else {
  window.AI_PROVIDERS = AI_PROVIDERS;
  window.DEFAULT_PROVIDER = DEFAULT_PROVIDER;
  window.SYSTEM_PROMPT = SYSTEM_PROMPT;
  window.STORAGE_KEYS = STORAGE_KEYS;
}
