# Headless tool execution (first pass)

Spatial Workbench now exposes a thin server-side execution path for a safe subset of tools.

## Endpoint

`POST /api/run`

There is also a discovery endpoint:

`GET /api/run`

That returns the supported headless tools, request shape, and notes about the current limitations.

## Scope of this first pass

Headless execution is intentionally limited to tools that can already run from structured params without browser-only UI state:

- `BufferTool`
- `ExportTool`
- `GroupTool`
- `RandomPointsTool`

Not yet supported headlessly:

- `AddDataTool` (browser `File`/`FileReader` flow)
- `GenerateAIFeatures` (currently coupled to browser-side settings/localStorage)

## Request shape

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
    "bbox": [-118.5, 33.5, -117.5, 34.5]
  }
}
```

### Notes

- `state.layers` is request-scoped. This first pass does **not** persist workbench state on the server between requests.
- Tools that refer to layers by id (for example `Input Layer` or `Polygon`) expect those ids to be present in `state.layers`.
- `state.bbox` is used by tools like `RandomPointsTool` when they need map bounds in headless mode.

## Response shape

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
    "layers": [
      {
        "id": "source-layer",
        "name": "Source Layer",
        "geometryType": "Point",
        "geojson": {}
      },
      {
        "id": "result-1",
        "name": "Buffer",
        "geometryType": "Polygon",
        "geojson": {}
      }
    ],
    "added": [
      {
        "id": "result-1",
        "name": "Buffer",
        "geojson": {}
      }
    ],
    "removed": [],
    "bbox": [-118.5, 33.5, -117.5, 34.5]
  }
}
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
3. decouple AI settings from browser localStorage for headless AI generation
4. standardize tool result envelopes across all tools
5. expand GroupTool output options beyond per-feature group attribution if we want hulls/centroids later
