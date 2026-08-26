# AI provider contract

Spatial Workbench keeps provider-specific response objects behind `js/ai/providerClient.js`.
Every successful chat-completion call is normalized to:

```js
{
  content,          // provider message content as a string
  provider,          // configured provider name
  model,             // effective provider model when available
  inputTokens,       // number or null when usage is unavailable
  outputTokens,      // number or null when usage is unavailable
  finishReason,      // string or null
  requestId,         // provider request ID or null
  latencyMs          // measured request latency or null
}
```

The application parses `content` only after it crosses this boundary. Provider
failures use `ProviderRequestError` with a category (`rate_limit`, `transient`,
`timeout`, `authentication`, `validation`, or `network`) and an explicit
`retryable` flag.

Requests use bounded exponential backoff with jitter for retryable failures.
Defaults are a 30-second timeout and two retries; configure them with
`AI_REQUEST_TIMEOUT_MS` and `AI_MAX_RETRIES`.

## Usage telemetry

The server emits one structured `[ai-usage]` log event per completed AI
operation. It contains provider, model, token counts when available, latency,
success/failure, request ID, and estimated USD cost. Prompts and model content
are intentionally excluded. The built-in table currently prices OpenAI
`gpt-4o`; additional pricing can be supplied with `AI_PRICING_JSON`. Unknown
models and providers report `estimatedCostUsd: null` and do not fail requests.
