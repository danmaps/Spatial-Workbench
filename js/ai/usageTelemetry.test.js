const { estimateCostUsd, recordUsageTelemetry } = require('./usageTelemetry');

describe('usageTelemetry', () => {
  test('estimates cost for known provider and model pricing', () => {
    expect(estimateCostUsd({ provider: 'OpenAI', model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.0075);
  });

  test('reports unknown pricing and missing usage as unavailable', () => {
    expect(estimateCostUsd({ provider: 'Ollama', model: 'qwen3:8b', inputTokens: 100, outputTokens: 100 })).toBeNull();
    expect(estimateCostUsd({ provider: 'OpenAI', model: 'gpt-4o', inputTokens: null, outputTokens: 10 })).toBeNull();
  });

  test('records operational metadata without prompt or response content', () => {
    const logger = { info: jest.fn() };
    const telemetry = recordUsageTelemetry({ provider: 'OpenAI', model: 'gpt-4o', inputTokens: 10, outputTokens: 20, latencyMs: 42, success: true, requestId: 'req-1' }, logger);
    expect(telemetry).toMatchObject({ event: 'ai_usage', success: true, latencyMs: 42, requestId: 'req-1' });
    expect(logger.info.mock.calls[0][0]).not.toContain('prompt');
    expect(logger.info.mock.calls[0][0]).not.toContain('response');
  });

  test('preserves authoritative provider-reported cost separately from estimates', () => {
    const telemetry = recordUsageTelemetry({
      provider: 'OpenRouter', model: 'openai/gpt-4o', inputTokens: 10, outputTokens: 20,
      reportedCost: 0.0003, reportedCostUnit: 'credits', success: true,
    }, { info: jest.fn() });
    expect(telemetry).toMatchObject({ reportedCost: 0.0003, reportedCostUnit: 'credits', costSource: 'provider' });
  });

  test('marks unavailable cost as unknown rather than an estimate', () => {
    const telemetry = recordUsageTelemetry({ provider: 'Ollama', model: 'qwen3:8b', success: true }, { info: jest.fn() });
    expect(telemetry).toMatchObject({ estimatedCostUsd: null, costSource: 'unknown' });
  });
});
