# Headless tool execution

Spatial Workbench exposes a server-side execution path for tools that can run from structured params without browser-only UI state.

## Endpoints

- `GET /api/tools` → returns the full tool spec catalog (all registered tools, including browser-only ones).
- `GET /api/state` → inspect the current server runtime state: session model, headless-safe tool keys, and spatial metadata.
- `GET /api/run` returns discovery metadata for callable tools.
- `POST /api/run` executes a tool against request-scoped state.
- `POST /api/datasets` registers GeoJSON and returns a dataset handle.
- `GET /api/datasets/:id` returns metadata and optional materialized GeoJSON (`?includeData=true`).
- `DELETE /api/datasets/:id` removes a dataset handle.
- `POST /api/datasets/cleanup` removes expired datasets from local storage.

The server does not persist workbench state between requests. Callers send the state needed for each run and receive the resulting state back in the response.
For workflows that outgrow inline payloads, an optional handle mode is available. See `docs/dataset-handle-architecture.md`.

## Spatial assumptions

The current runtime assumes:

- incoming GeoJSON coordinates are `EPSG:4326`
- coordinate order is `longitude,latitude`
- measurements run through `@turf/turf` and are suitable for lightweight web/runtime analysis
- results are not framed as engineering, cadastral, or survey-grade precision

The API now returns those assumptions in machine-readable `spatial` metadata and includes structured warnings whenever coordinates, geometry, or output quality look suspicious.

## Supported state modes

Layer-state tools use `state.layers` plus optional `state.bbox` and `state.selection`:

- `BufferTool`
- `ExportTool`
- `GroupTool`
- `RandomPointsTool`

Feature-collection tools use `state.featureCollection` plus optional `state.selection.featureIds`:

- `AddAIGeneratedFieldTool`
- `ConvertTextToNumericTool`

Not yet supported headlessly:

- `AddDataTool` because it still depends on browser `File` / `FileReader` flow.
- `GenerateAIFeatures` because it still depends on browser-side settings and localStorage.

## Layer-State Request

```json
{
  "tool": "BufferTool",
  "params": {
    "Input Layer": "source-layer",
    "Distance": 5,
    "Units": "miles"
  },
  "state": {
    "layers": [
      {
        "id": "source-layer",
        "name": "Source Layer",
        "geojson": {
          "type": "FeatureCollection",
          "features": []
        }
      }
    ],
    "bbox": [-118.5, 33.5, -117.5, 34.5],
    "selection": {
      "activeLayerId": "source-layer",
      "selectedLayerIds": ["source-layer"],
      "selectedFeaturesByLayerId": {}
    }
  }
}
```

Tools that refer to layers by id expect those ids to be present in `state.layers`. `state.bbox` is used by tools like `RandomPointsTool` when they need map bounds in headless mode.

Layer entries can optionally use `datasetRef` instead of inline `geojson`:

```json
{
  "state": {
    "layers": [
      {
        "id": "source-layer",
        "datasetRef": "dataset://abc123"
      }
    ]
  }
}
```

## Feature-Collection Request

```json
{
  "tool": "ConvertTextToNumericTool",
  "params": {
    "Input Field Name": "population_text",
    "Output Field Name": "population",
    "Overwrite Existing Field": false,
    "Use AI Fallback": false
  },
  "state": {
    "featureCollection": {
      "type": "FeatureCollection",
      "features": []
    },
    "selection": {
      "featureIds": []
    }
  }
}
```

If `selection.featureIds` is empty, feature-collection tools operate on all features.

## Response Contract

All successful tool calls and tool-level validation failures use the same envelope:

```json
{
  "ok": true,
  "tool": "BufferTool",
  "status": {
    "code": 0,
    "message": "Buffered layer added to map."
  },
  "output": {
    "ok": true,
    "added": ["result-1"],
    "removed": [],
    "errors": []
  },
  "state": {
    "layers": [],
    "added": [],
    "removed": [],
    "bbox": [-118.5, 33.5, -117.5, 34.5]
  },
  "spatial": {
    "crs": "EPSG:4326",
    "coordinateOrder": "longitude,latitude",
    "engine": "@turf/turf",
    "measurementModel": "geodesic/web-oriented",
    "precision": "not-survey-grade",
    "warnings": []
  },
  "execution": {
    "startedAt": "2026-07-21T03:27:44.000Z",
    "finishedAt": "2026-07-21T03:27:44.012Z",
    "durationMs": 12,
    "inputLayerIds": ["source-layer"],
    "outputLayerIds": ["result-1"],
    "featureCounts": {
      "input": 3,
      "output": 3
    },
    "datasetHandles": {
      "read": ["dataset://abc123"],
      "produced": [
        { "layerId": "result-1", "datasetRef": "dataset://def456" }
      ],
      "expired": []
    }
  }
}
```

For feature-collection tools, the updated FeatureCollection is returned in top-level `state`. The `output` object contains operation details such as counts and updated ids, not a nested state copy.
`execution` is the API-level receipt used by the demo client and tests. It keeps the runtime inspectable without forcing every tool to share the same internal output shape.
`spatial` is the honesty layer: it declares the current CRS/measurement assumptions and carries structured warnings that agents, scripts, and browser clients can inspect directly.

## Workload limits

`POST /api/run` is bounded: payload size, layer/feature/vertex counts,
tool-specific parameters, execution time, concurrency, and request rate are all
enforced, and every violation returns a structured `{ ok: false, code, error, limit, received }`
envelope. Execution runs in a worker thread that is terminated when the deadline
elapses, so a timed-out request stops consuming CPU.

Effective values are published by `GET /api/state` under `workloadLimits`, with
`limitConfiguration` describing which environment variables are re-read per
request and which require a restart.

See `docs/hosted-workload-envelope.md` for defaults, error codes, appropriate
and inappropriate hosted workloads, and how to raise the limits for a
self-hosted instance.

## Validation Failures

Tools run `validate(params, context)` before execution. Tool-level validation failures return HTTP `200` with `ok: false`, `output: null`, and the normalized request state.

```json
{
  "ok": false,
  "tool": "BufferTool",
  "status": {
    "code": 2,
    "message": "No layer selected."
  },
  "validation": {
    "ok": false,
    "errors": ["No layer selected."]
  },
  "output": null,
  "state": {
    "layers": [],
    "added": [],
    "removed": [],
    "bbox": null
  },
  "execution": {
    "startedAt": "2026-07-21T03:27:44.000Z",
    "finishedAt": "2026-07-21T03:27:44.001Z",
    "durationMs": 1,
    "inputLayerIds": [],
    "outputLayerIds": [],
    "featureCounts": {
      "input": 0,
      "output": 0
    }
  }
}
```

Unsupported tools and malformed API requests still use HTTP `4xx` responses.

## Spatial validation failures

Malformed spatial state now fails before tool execution with HTTP `400` and structured validation details:

```json
{
  "ok": false,
  "error": "Invalid spatial input.",
  "validation": {
    "ok": false,
    "errors": [
      {
        "code": "coordinate-out-of-range",
        "message": "Coordinates fall outside the valid EPSG:4326 longitude/latitude range.",
        "path": "state.layers[0].geojson.features[0].geometry.coordinates"
      }
    ]
  },
  "spatial": {
    "crs": "EPSG:4326",
    "coordinateOrder": "longitude,latitude",
    "engine": "@turf/turf",
    "measurementModel": "geodesic/web-oriented",
    "precision": "not-survey-grade",
    "warnings": [
      {
        "code": "coordinates-look-reversed",
        "severity": "warning",
        "message": "Coordinates look like latitude/longitude may be reversed."
      }
    ]
  }
}
```

That distinction is intentional:

- malformed spatial state => HTTP `400`
- valid request shape but invalid tool params => HTTP `200` with `ok: false`
- valid run with suspicious but usable geometry => HTTP `200` plus `spatial.warnings`

## Structured spatial warnings

Warnings are emitted without forcing the whole tool call to fail when the runtime can still produce a usable result. Examples:

- `coordinates-look-projected`
- `coordinates-look-reversed`
- `geometry-null`
- `geometry-required-by-tool`
- `mixed-geometry-types`
- `buffer-skipped-features`
- `group-centroid-approximation`

For example, `BufferTool` can now skip null/empty features, return a successful result for the valid remainder, and report the skipped count in `spatial.warnings`.

## API Test Fixtures

The HTTP-level headless tests live in `server.headless.test.js`. They start the Express app on an ephemeral port and call `/api/run` with Node's `http` module, so they exercise the API independently of the front-end bundle and browser UI.

Reusable sample GeoJSON and known-good outputs live in `test/fixtures/headless-api/`:

- `source-points.geojson` is the shared input layer.
- `boundary-polygon.geojson` is used for polygon-scoped random point requests.
- `expected-buffer-summary.json` is compared against stable `BufferTool` output fields.
- `expected-export-source-points.geojson` is compared exactly against `ExportTool` output.
- `expected-convert-text-to-numeric.geojson` is compared against `ConvertTextToNumericTool` output after removing dynamic tool metadata.
- `expected-grouped-points.geojson` is compared against `GroupTool` output after removing dynamic tool metadata.
- `turf-derived/` contains a small MIT-licensed subset of Turf.js fixtures for polygon holes, buffer edge cases, and DBSCAN property preservation. See `test/fixtures/headless-api/README.md` for exact upstream paths and license notes.

Run only the API fixture suite with:

```bash
npm test -- --runInBand server.headless.test.js
```

## Why this shape

It is designed to be:

- easy to call from a repo-native CLI/demo wrapper
- simple for MCP/agent adapters to serialize
- explicit about inputs and outputs
- non-breaking for the existing browser UI

## CLI

A thin CLI wrapper over the headless runtime is available at `scripts/workbench-cli.js`:

```bash
# List supported headless tools
node scripts/workbench-cli.js list

# Inspect server runtime state
node scripts/workbench-cli.js state

# Run a tool
node scripts/workbench-cli.js run --tool RandomPointsTool \
  --params '{"Points Count":5,"Inside Polygon":false}' \
  --state '{"bbox":[-118.5,33.5,-118.2,33.8]}'

# Pretty-print the full JSON response
node scripts/workbench-cli.js run --tool ExportTool \
  --params '{"Layer":"layer-1","Format":"GeoJSON"}' \
  --state state.json --pretty
```

Or use the npm script alias:

```bash
npm run cli -- list
npm run cli -- run --tool RandomPointsTool --params '{"Points Count":3,"Inside Polygon":false}' --state '{"bbox":[-118.5,33.5,-118.2,33.8]}'
```

Set `HEADLESS_API_URL` to point the CLI at an already-running server instead of starting a local one:

```bash
HEADLESS_API_URL=https://workbench.example.com npm run cli -- list
```

## Next likely steps

1. extend the demo contract to more tools after the chained `RandomPointsTool -> BufferTool -> ExportTool` flow is stable
2. make `AddDataTool` accept JSON/file-path friendly server inputs
3. decouple AI geometry generation from browser localStorage
4. expand GroupTool output options beyond per-feature group attribution if hulls or centroids become useful
