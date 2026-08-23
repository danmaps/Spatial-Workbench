# Hosted workload envelope

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
