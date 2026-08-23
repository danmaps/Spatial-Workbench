# Hosted workload envelope

> **Non-authoritative notice:** The hosted API is suitable for exploration,
> prototyping, and bounded GeoJSON analysis. It is **not** authoritative for
> production, regulated, or mission-critical use until enterprise authentication,
> audit logging, change-approval workflows, and data-governance controls are in
> place. Do not process personally identifiable information, classified data, or
> datasets subject to regulatory compliance on the public hosted instance.

`POST /api/run` executes spatial tools synchronously inside a bounded execution
envelope. This page documents what the hosted deployment is designed to handle,
what it is not, and how to change the limits for a self-hosted instance.

## Execution model

Each `POST /api/run` call executes the tool in a dedicated **worker thread**.
The worker is terminated when the execution deadline elapses, so a request that
runs long — including synchronous, CPU-bound Turf work — is actually stopped
rather than left blocking the process. Concurrency is accounted by live worker
threads: a slot is taken when the worker starts and released exactly once, when
the thread has exited (success, failure, or termination).

There is no durable job queue. Work that cannot finish inside the deadline is
not resumable and should be run locally instead.

## Limits

| Limit | Default | Env var | Error code |
|---|---|---|---|
| Request body | 5 MB | `MAX_REQUEST_BYTES` | `PAYLOAD_TOO_LARGE` 413 |
| Layers per request | 20 | `MAX_LAYERS` | `LAYER_LIMIT` 422 |
| Total features | 50 000 | `MAX_FEATURES` | `FEATURE_LIMIT` 422 |
| Total vertices | 2 000 000 | `MAX_VERTICES` | `VERTEX_LIMIT` 422 |
| Tool execution | 30 s | `TOOL_TIMEOUT_MS` | `EXECUTION_TIMEOUT` 503 |
| Concurrent runs | 10 | `MAX_CONCURRENT_RUNS` | `CONCURRENCY_LIMIT` 503 |
| Rate (per minute) | 60 | `API_RUN_RATE_LIMIT_MAX` | `RATE_LIMIT` 429 |
| `RandomPointsTool` → `Points Count` | 10 000 | `MAX_RANDOM_POINTS` | `PARAM_LIMIT` 422 |
| `BufferTool` → `Distance` | 500 (requested units) | `MAX_BUFFER_DISTANCE` | `PARAM_LIMIT` 422 |

Feature and vertex counts are measured **after** dataset handles are resolved
and state is normalized, so `state.layers`, `datasetRef` handles, and
`state.featureCollection` inputs all count against the same budget. Nested
`GeometryCollection` geometries are included in the vertex count.

Every violation returns the same envelope:

```json
{ "ok": false, "code": "FEATURE_LIMIT", "error": "...", "limit": 50000, "received": 61200 }
```

## HTTP error response meanings

| HTTP status | When it is returned | What to do |
|---|---|---|
| **413 Payload Too Large** | The raw request body exceeds `MAX_REQUEST_BYTES` (default 5 MB). The body is rejected before parsing. | Reduce inline GeoJSON. Use `POST /api/datasets` to register large layers as handles and pass `datasetRef` references instead. |
| **422 Unprocessable Entity** | The request was parsed and structurally valid, but one or more workload limits were exceeded (`LAYER_LIMIT`, `FEATURE_LIMIT`, `VERTEX_LIMIT`, `PARAM_LIMIT`) or the spatial input failed validation. | Reduce the number of layers, features, or vertices; lower the tool-specific parameter value; or fix the malformed geometry. |
| **429 Too Many Requests** | The caller has exceeded the per-IP rate limit (`API_RUN_RATE_LIMIT_MAX` per `API_RUN_RATE_LIMIT_WINDOW_MS`, default 60 req/min). | Back off and retry after the window resets. The `Retry-After` header indicates the wait time. For sustained workloads, run a self-hosted instance with a higher limit. |
| **503 Service Unavailable** | Either the tool execution timed out (`EXECUTION_TIMEOUT`) or all concurrency slots are occupied (`CONCURRENCY_LIMIT`). The server is healthy but currently cannot accept the request. | Reduce payload size or try again shortly. For jobs that regularly approach the timeout, run them locally or on a self-hosted instance with a higher `TOOL_TIMEOUT_MS`. |

## Configuration scope

Not every limit can change without a restart, and `GET /api/state` reports which
is which under `limitConfiguration`:

- **Dynamic** (re-read per request): `MAX_LAYERS`, `MAX_FEATURES`,
  `MAX_VERTICES`, `TOOL_TIMEOUT_MS`, `MAX_CONCURRENT_RUNS`, `MAX_RANDOM_POINTS`,
  `MAX_BUFFER_DISTANCE`.
- **Startup-only** (bound to middleware constructed at boot):
  `MAX_REQUEST_BYTES`, `API_RUN_RATE_LIMIT_MAX`, `API_RUN_RATE_LIMIT_WINDOW_MS`.

`GET /api/state` also reports the effective values in `workloadLimits` and the
current worker count in `execution.activeRuns`.

## Appropriate hosted workloads

- Interactive, human-in-the-loop analysis on small to mid-sized layers.
- Demos, tutorials, and documentation examples.
- Agent/MCP calls that buffer, group, export, or enrich a few thousand features.
- Chained calls that pass large intermediates by dataset handle
  (`POST /api/datasets`) instead of re-uploading GeoJSON each time.

## Inappropriate hosted workloads

Run these locally (`npm start`, the CLI, or the MCP server) with raised limits:

- Bulk or batch processing of national/continental datasets.
- Long-running jobs that cannot complete within the execution deadline.
- Dense geometry work such as buffering millions of vertices or generating very
  large random point sets.
- Sustained automated pipelines that would monopolize concurrency for other
  users.
- Anything requiring durable, resumable jobs or guaranteed completion.

## Self-hosting with higher limits

All limits are environment variables, so a trusted local instance can raise
them in `.env`:

```
MAX_LAYERS=1000
MAX_FEATURES=5000000
MAX_VERTICES=50000000
TOOL_TIMEOUT_MS=600000
MAX_CONCURRENT_RUNS=4
MAX_RANDOM_POINTS=1000000
MAX_BUFFER_DISTANCE=10000
MAX_REQUEST_BYTES=104857600
```

Startup-only values require restarting the server. Raise `MAX_CONCURRENT_RUNS`
carefully: each concurrent run is a real thread with its own memory.

## Deployment notes

- The rate limiter runs before request parsing/validation for `POST /api/run`,
  so rejected callers do not consume execution capacity.
- If the app runs behind a proxy or CDN, configure Express `trust proxy` for the
  actual deployment so rate limiting keys on the real client IP rather than the
  proxy's.
- Public defaults are intentionally conservative and should be load-tested
  before being raised for a shared deployment.
