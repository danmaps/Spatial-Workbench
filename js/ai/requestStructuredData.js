async function getFetchImpl() {
  if (typeof fetch === 'function') {
    return fetch.bind(globalThis);
  }

  throw new Error('Fetch is unavailable in this runtime.');
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || '';
}

function extractJsonPayload(data) {
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('AI response did not include message content.');
  }

  return JSON.parse(content);
}

async function requestStructuredData({ systemPrompt, userPrompt, model = 'gpt-4o', temperature = 0.2, maxTokens = 1200 }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const fetchImpl = await getFetchImpl();
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
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
