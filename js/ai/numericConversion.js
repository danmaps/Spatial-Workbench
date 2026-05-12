const { requestStructuredData } = require('./requestStructuredData');

function parseNumericText(value) {
  if (value === null || value === undefined) {
    return { ok: false, reason: 'empty' };
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value, mode: 'native-number' }
      : { ok: false, reason: 'non-finite' };
  }

  const text = String(value).trim();
  if (!text) {
    return { ok: false, reason: 'empty' };
  }

  const negativeByParens = /^\(.*\)$/.test(text);
  const normalized = text
    .replace(/[,$]/g, '')
    .replace(/[%]/g, '')
    .replace(/[()]/g, '')
    .trim();

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return { ok: true, value: negativeByParens ? -parsed : parsed, mode: 'strict' };
    }
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return { ok: false, reason: 'no-number-token' };
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: 'parse-failed' };
  }

  return { ok: true, value: negativeByParens ? -Math.abs(parsed) : parsed, mode: 'token-extract' };
}

async function convertTextsToNumbersWithAI(items) {
  if (!items.length) return [];

  const systemPrompt = [
    'Convert text field values into numbers.',
    'Return only JSON with shape {"results":[{"id":"...","value":123.45|null}]}',
    'Use null when the text cannot reasonably be converted into a number.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    items: items.map((item) => ({
      id: item.id,
      value: item.value,
    })),
  });

  const response = await requestStructuredData({
    systemPrompt,
    userPrompt,
    temperature: 0,
    maxTokens: 1000,
  });

  const results = Array.isArray(response && response.results) ? response.results : [];
  const byId = new Map();
  for (const result of results) {
    if (!result || !result.id) continue;
    const value = result.value;
    byId.set(result.id, value === null || value === undefined ? null : Number(value));
  }

  return items.map((item) => {
    const value = byId.get(item.id);
    return {
      id: item.id,
      value: Number.isFinite(value) ? value : null,
    };
  });
}

module.exports = {
  parseNumericText,
  convertTextsToNumbersWithAI,
};
