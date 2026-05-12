/**
 * AI Provider registry.
 *
 * Defines the supported LLM providers and their connection details.
 * Used by both the server (proxy) and the frontend (settings UI).
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:1.5b';
const KNOWN_OLLAMA_MODELS = [
  DEFAULT_OLLAMA_MODEL,
  'qwen3:8b',
  'qwen3:4b-thinking',
  'qwen3:4b',
];

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
    name: 'Built-in AI',
    endpoint: `${DEFAULT_OLLAMA_URL}/v1/chat/completions`,
    defaultModel: DEFAULT_OLLAMA_MODEL,
    requiresKey: false,
    description: 'Built-in AI served by this Workbench backend — no API key needed',
    defaultUrl: DEFAULT_OLLAMA_URL,
    fallbackModels: KNOWN_OLLAMA_MODELS,
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
  module.exports = {
    AI_PROVIDERS,
    DEFAULT_PROVIDER,
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_OLLAMA_URL,
    KNOWN_OLLAMA_MODELS,
    SYSTEM_PROMPT,
    STORAGE_KEYS,
  };
} else {
  window.AI_PROVIDERS = AI_PROVIDERS;
  window.DEFAULT_PROVIDER = DEFAULT_PROVIDER;
  window.DEFAULT_OLLAMA_MODEL = DEFAULT_OLLAMA_MODEL;
  window.DEFAULT_OLLAMA_URL = DEFAULT_OLLAMA_URL;
  window.KNOWN_OLLAMA_MODELS = KNOWN_OLLAMA_MODELS;
  window.SYSTEM_PROMPT = SYSTEM_PROMPT;
  window.STORAGE_KEYS = STORAGE_KEYS;
}
