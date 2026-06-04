# Headless tool execution

Spatial Workbench exposes a server-side execution path for tools that can run from structured params without browser-only UI state.

## Endpoints

- `GET /api/run` returns discovery metadata for callable tools.
- `POST /api/run` executes a tool against request-scoped state.

The server does not persist workbench state between requests. Callers send the state needed for each run and receive the resulting state back in the response.

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
  }
}
```

For feature-collection tools, the updated FeatureCollection is returned in top-level `state`. The `output` object contains operation details such as counts and updated ids, not a nested state copy.

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
  }
}
```

Unsupported tools and malformed API requests still use HTTP `4xx` responses.

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

- easy to call from a future CLI wrapper
- simple for MCP/agent adapters to serialize
- explicit about inputs and outputs
- non-breaking for the existing browser UI

## Next likely steps

1. add a small CLI wrapper around `POST /api/run`
2. make `AddDataTool` accept JSON/file-path friendly server inputs
3. decouple AI geometry generation from browser localStorage
4. build an MCP-facing adapter on top of this contract
5. expand GroupTool output options beyond per-feature group attribution if hulls or centroids become useful
