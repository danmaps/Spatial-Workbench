# Serialized spatial expressions

Spatial expressions are small, versioned JSON documents for replaying an already-decided Workbench tool chain. The expression records intent; the existing headless API remains responsible for execution.

## Example

```sh
npm run run:expression -- examples/random-points-buffer-export.swx.json
```

The example runs `RandomPointsTool -> BufferTool -> ExportTool` and prints a composite receipt containing each underlying `/api/run` response.

## Format

An expression has `version: 1`, request-scoped initial `state`, and ordered `steps`. Each step has a unique `id`, a registered `tool`, and JSON `params`. A parameter can reference a completed step with a JSON object such as:

```json
{ "$ref": "points.state.added[0].id" }
```

References are resolved only against completed steps. Missing, forward, or ambiguous references fail before the dependent call. Execution is sequential and stops on the first tool failure.

The runner enforces a maximum of 20 steps and 256 KiB per expression by default. It validates the advertised headless tool catalog before making tool calls.

This is deliberately not a workflow language: no loops, conditionals, parallelism, dynamic discovery, arbitrary code, or agent reasoning traces. MCP can expose this capability later as a thin transport adapter.

## Background

For context on the motivation and design decisions behind this feature, see the original concept document:

- [`execution-engine-reframing.md`](execution-engine-reframing.md)
- [`headless-api.md`](headless-api.md)
- [`dataset-handle-architecture.md`](dataset-handle-architecture.md)

**Agent plans. Expression records. Engine executes. Tools do the work.**
