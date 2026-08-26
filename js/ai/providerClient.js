class ProviderRequestError extends Error {
  constructor(message, { provider, model, status, category, retryable, cause } = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.category = category || 'unknown';
    this.retryable = Boolean(retryable);
    if (cause) this.cause = cause;
  }
}

function classifyStatus(status) {
  if (status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599)) {
    return { category: status === 429 ? 'rate_limit' : 'transient', retryable: true };
  }
  if (status === 401 || status === 403) return { category: 'authentication', retryable: false };
  if (status >= 400 && status <= 499) return { category: 'validation', retryable: false };
  return { category: 'provider_error', retryable: false };
}

function normalizeProviderResponse(data, { provider, model, latencyMs } = {}) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const usage = data?.usage || {};
  const content = message.content;
  if (content == null || String(content).trim() === '') {
    throw new ProviderRequestError('AI response did not include message content.', {
      provider,
      model,
      category: 'invalid_response',
      retryable: false,
    });
  }

  return {
    content: String(content),
    provider: provider || null,
    model: data?.model || model || null,
    inputTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
    outputTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
    reportedCost: Number.isFinite(usage.cost) ? usage.cost : null,
    reportedCostUnit: Number.isFinite(usage.cost) ? 'credits' : null,
    finishReason: choice.finish_reason || null,
    requestId: data?.id || null,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
  };
}

async function readErrorBody(response) {
  try {
    const body = await response.text();
    return body ? `: ${body.slice(0, 500)}` : '';
  } catch (_error) {
    return '';
  }
}

async function requestProviderResponse({
  fetchImpl,
  endpoint,
  headers,
  body,
  provider,
  model,
  timeoutMs = 30000,
  maxRetries = 2,
  baseDelayMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const attempts = Math.max(0, Number.isInteger(maxRetries) ? maxRetries : 2);

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer;
    try {
      if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!response.ok) {
        const classification = classifyStatus(response.status);
        throw new ProviderRequestError(
          `${provider} request failed (${response.status})${await readErrorBody(response)}`,
          { provider, model, status: response.status, ...classification }
        );
      }

      const data = await response.json();
      return normalizeProviderResponse(data, { provider, model, latencyMs: Date.now() - startedAt });
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      const normalizedError = error instanceof ProviderRequestError
        ? error
        : new ProviderRequestError(
          isAbort ? `${provider} request timed out after ${timeoutMs}ms.` : `${provider} request failed: ${error.message}`,
          { provider, model, category: isAbort ? 'timeout' : 'network', retryable: true, cause: error }
        );
      normalizedError.latencyMs = Date.now() - startedAt;

      if (!normalizedError.retryable || attempt >= attempts) throw normalizedError;
      const backoff = baseDelayMs * (2 ** attempt);
      await sleep(backoff + Math.floor(random() * Math.max(1, baseDelayMs)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new ProviderRequestError(`${provider} request failed.`, { provider, model });
}

module.exports = {
  ProviderRequestError,
  classifyStatus,
  normalizeProviderResponse,
  requestProviderResponse,
};
