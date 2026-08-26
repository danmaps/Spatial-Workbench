const DEFAULT_PRICING_USD_PER_1K_TOKENS = {
  openai: {
    'gpt-4o': { input: 0.0025, output: 0.01 },
  },
};

function getPricingTable(overrides) {
  if (overrides) return overrides;
  if (typeof process !== 'undefined' && process.env?.AI_PRICING_JSON) {
    try {
      return { ...DEFAULT_PRICING_USD_PER_1K_TOKENS, ...JSON.parse(process.env.AI_PRICING_JSON) };
    } catch (_error) {
      // Invalid optional pricing configuration must not break AI requests.
    }
  }
  return DEFAULT_PRICING_USD_PER_1K_TOKENS;
}

function estimateCostUsd({ provider, model, inputTokens, outputTokens, pricingTable } = {}) {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const pricing = getPricingTable(pricingTable)?.[String(provider || '').toLowerCase()]?.[model];
  if (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output)) return null;
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

function buildUsageTelemetry({ provider, model, inputTokens, outputTokens, reportedCost, reportedCostUnit, latencyMs, success, errorCategory, requestId, pricingTable } = {}) {
  const estimatedCostUsd = estimateCostUsd({ provider, model, inputTokens, outputTokens, pricingTable });
  return {
    event: 'ai_usage',
    provider: provider || null,
    model: model || null,
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    estimatedCostUsd,
    reportedCost: Number.isFinite(reportedCost) ? reportedCost : null,
    reportedCostUnit: reportedCostUnit || null,
    costSource: Number.isFinite(reportedCost) ? 'provider' : (estimatedCostUsd !== null ? 'local_estimate' : 'unknown'),
    success: Boolean(success),
    ...(errorCategory ? { errorCategory } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function recordUsageTelemetry(details, logger = console) {
  const telemetry = buildUsageTelemetry(details);
  logger.info(`[ai-usage] ${JSON.stringify(telemetry)}`);
  return telemetry;
}

module.exports = { DEFAULT_PRICING_USD_PER_1K_TOKENS, estimateCostUsd, buildUsageTelemetry, recordUsageTelemetry };
