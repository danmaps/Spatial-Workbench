# Dataset handle prototype (issue #107)

## Goal

Keep the existing request-scoped inline GeoJSON contract as the default while adding an optional handle flow for larger chained runs.

## Execution modes

### Inline-state mode (unchanged)

- Caller sends `state.layers[].geojson`.
- Server validates and runs the tool.
- Response returns full GeoJSON state.
- Best for portable, explicit, small payload workflows.

### Reference-state mode (new optional prototype)

- Caller registers GeoJSON with `POST /api/datasets`.
- Server returns an opaque `dataset://...` handle.
- Caller sends `state.layers[].datasetRef` to `/api/run`.
- Server resolves handles, executes tool, stores response layers, and returns handle-based layer state.

## Storage-provider interface

The prototype keeps storage behind `js/runtime/datasetStore.js`:

- `registerDataset({ ownerId, geojson, ttlMs, name })`
- `getDataset({ datasetRef, ownerId, includeData })`
- `resolveDatasetReference({ datasetRef, ownerId })`
- `deleteDataset({ datasetRef, ownerId })`
- `cleanupExpiredDatasets()`

Current implementation is process-local in-memory storage so it can be replaced later by filesystem/object storage without changing route/tool wiring.

## Ownership, security boundary, expiration, cleanup

- Ownership is request-scoped via `x-workbench-owner` (default: `anonymous`).
- A handle can only be resolved/materialized/deleted by the same owner id.
- Handles include TTL (`ttlMs`) and expire automatically.
- `POST /api/datasets/cleanup` removes expired records explicitly.

Failure modes are explicit:

- missing handle → `404` (`dataset-not-found`)
- expired handle → `410` (`dataset-expired`)
- wrong owner → `403` (`dataset-access-denied`)

## Tool execution receipts

`/api/run` receipts now include `execution.datasetHandles`:

- `read`: resolved input handles
- `produced`: new output handles
- `expired`: reserved for future explicit expiry reporting

This keeps state/provenance visible while reducing repeated GeoJSON transfer in chained handle-mode runs.
