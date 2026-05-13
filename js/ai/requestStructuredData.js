const { STORAGE_KEYS, DEFAULT_PROVIDER, AI_PROVIDERS } = require('../ai-providers');

async function getFetchImpl() {
  if (typeof fetch === 'function') {
    return fetch.bind(globalThis);
  }

  if (typeof window === 'undefined') {
    try {
      const fetchModule = await import(/* webpackIgnore: true */ 'node-fetch');
      const fetchImpl = fetchModule.default || fetchModule;
      if (typeof fetchImpl === 'function') {
        return fetchImpl;
      }
    } catch (error) {
      throw new Error(`Fetch is unavailable and node-fetch could not be loaded: ${error.message}`);
    }
  }

  throw new Error('Fetch is unavailable in this runtime. Provide global fetch or install node-fetch.');
}

function getApiKey() {
  if (typeof process === 'undefined' || !process || !process.env) {
    return '';
  }
  return process.env.OPENAI_API_KEY || '';
}

function extractJsonPayload(data) {
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('AI response did not include message content.');
  }

  return JSON.parse(content);
}

async function requestStructuredData({ systemPrompt, userPrompt, model = 'gpt-4o', temperature = 0.2, maxTokens = 1200, provider, apiKey: requestedApiKey, ollamaUrl }) {
  if (typeof window !== 'undefined') {
    const fetchImpl = await getFetchImpl();
    const savedProvider = provider || localStorage.getItem(STORAGE_KEYS.provider) || DEFAULT_PROVIDER;
    const savedApiKey = requestedApiKey !== undefined ? requestedApiKey : (localStorage.getItem(STORAGE_KEYS.apiKey) || '');
    const savedOllamaUrl = ollamaUrl !== undefined ? ollamaUrl : (localStorage.getItem(STORAGE_KEYS.ollamaUrl) || '');
    const savedModel = model || localStorage.getItem(STORAGE_KEYS.model) || AI_PROVIDERS[savedProvider]?.defaultModel || 'gpt-4o';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (savedApiKey) headers.Authorization = `Bearer ${savedApiKey}`;

    const response = await fetchImpl('/api/ai_structured', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemPrompt,
        userPrompt,
        model: savedModel,
        provider: savedProvider,
        ollamaUrl: savedOllamaUrl,
        temperature,
        maxTokens,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`AI request failed with status ${response.status}${body ? `: ${body}` : ''}`);
    }

    return response.json();
  }

  const envApiKey = getApiKey();
  if (!envApiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const fetchImpl = await getFetchImpl();
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${envApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI request failed with status ${response.status}${body ? `: ${body}` : ''}`);
  }

  const data = await response.json();
  return extractJsonPayload(data);
}

module.exports = {
  requestStructuredData,
};
