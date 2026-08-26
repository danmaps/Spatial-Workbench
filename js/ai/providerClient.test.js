const { classifyStatus, normalizeProviderResponse, requestProviderResponse } = require('./providerClient');

describe('providerClient', () => {
  test('classifies transient and permanent provider failures', () => {
    expect(classifyStatus(429)).toEqual({ category: 'rate_limit', retryable: true });
    expect(classifyStatus(503)).toEqual({ category: 'transient', retryable: true });
    expect(classifyStatus(400)).toEqual({ category: 'validation', retryable: false });
  });

  test('normalizes provider response metadata without requiring usage fields', () => {
    expect(normalizeProviderResponse({
      id: 'req-1', model: 'test-model',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    }, { provider: 'test', model: 'requested-model', latencyMs: 12 })).toEqual({
      content: '{"ok":true}', provider: 'test', model: 'test-model', inputTokens: 4,
      outputTokens: 6, finishReason: 'stop', requestId: 'req-1', latencyMs: 12,
    });
  });

  test('retries a transient response with bounded backoff', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await requestProviderResponse({
      fetchImpl, endpoint: 'https://example.test', headers: {}, body: {}, provider: 'test', model: 'm',
      maxRetries: 1, baseDelayMs: 10, sleep, random: () => 0,
    });

    expect(result.content).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  test('does not retry validation failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '' });
    await expect(requestProviderResponse({
      fetchImpl, endpoint: 'https://example.test', headers: {}, body: {}, provider: 'test', model: 'm', maxRetries: 3,
    })).rejects.toMatchObject({ category: 'validation', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
