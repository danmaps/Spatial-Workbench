# Headless Demo

This is the narrow proof artifact for issue `#100`.

It proves that Spatial Workbench can behave like a callable spatial runtime outside the browser by:

- discovering callable tools from `GET /api/run`
- executing `RandomPointsTool -> BufferTool -> ExportTool`
- passing the returned serialized `state` from each response into the next request unchanged
- writing a final GeoJSON artifact to disk

## Run It

Start from the repo root:

```bash
node scripts/headless-demo.js
```

By default, the script starts the Express app on an ephemeral local port, runs the three-step flow, then shuts the server down.

To point at an already-running API instead:

```bash
HEADLESS_API_URL=http://127.0.0.1:3000 node scripts/headless-demo.js
```

## Browser Demo

There is also a same-origin browser version of the demo at:

```text
/headless-demo
```

That page calls the deployed server from the client with `fetch('/api/run')`, renders live execution receipts in the browser, and exposes a downloadable GeoJSON artifact without starting a local server inside the page itself.

## Expected Receipts

The script prints one compact receipt per step, for example:

```text
Started local headless API at http://127.0.0.1:43219
[1/3] RandomPointsTool | status=0:Added 5 point(s). | duration=8ms | inputLayers=none | outputLayers=result-1 | features=0->5
[2/3] BufferTool | status=0:Buffered layer added to map. | duration=14ms | inputLayers=result-1 | outputLayers=result-2 | features=5->5
[3/3] ExportTool | status=0:Prepared GeoJSON export. | duration=2ms | inputLayers=result-2 | outputLayers=none | features=5->5
Wrote /path/to/repo/artifacts/headless-demo.geojson
```

The exact ids, timings, and output port will vary. The important part is that each step exposes:

- tool status
- duration
- input layer ids
- output layer ids
- input/output feature counts

## Output File

The final export is written to:

```text
artifacts/headless-demo.geojson
```

That file is ignored by Git so the demo can be rerun locally without polluting the working tree.

## Request Transitions

The chained flow is:

1. `RandomPointsTool` receives only a fixed `bbox` and point count.
2. `BufferTool` receives the entire `state` returned by step 1 and targets the layer id from step 1's receipt.
3. `ExportTool` receives the entire `state` returned by step 2 and targets the buffered layer id from step 2's receipt.

The caller should not guess generated layer ids or rebuild state by hand. The response `state` is the authoritative serialized handoff between steps.

## What This Defers

This demo intentionally does not prove:

- browser upload flows like `AddDataTool`
- AI-provider-dependent tools
- persisted sessions or server-side state storage
- MCP wrapping
- full internal runtime unification

It is the smallest repo-native artifact that proves the existing headless seam is already usable from an external caller.
