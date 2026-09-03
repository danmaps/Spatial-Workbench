# MCP Server

This is the first-pass MCP layer for Spatial Workbench.

It is available locally with `npm run mcp:server` and is also designed to point
at the deployed runtime with `HEADLESS_API_URL`. It is a transport adapter, not
a separate spatial engine.

The design is intentionally thin:

- MCP `list_tools` wraps `GET /api/run`
- MCP `get_runtime_info` wraps `GET /api/state`
- MCP `inspect_state` summarizes caller-owned serialized state without mutating it
- MCP `run_tool` wraps `POST /api/run`
- returned `state` stays opaque and serializable
- returned `execution` stays the agent-readable audit trail

Workbench remains the execution engine. MCP is only the agent-facing transport and tool wrapper.

## Why this shape

The headless API already proves the important substrate:

- discovery works
- request-scoped execution works
- state can be handed from one call to the next without server-side session magic
- execution receipts expose timing, input layer ids, output layer ids, and feature counts

That means the MCP server does not need tool-specific adapters or a parallel runtime model in v1.

## Run It

From the repo root:

```bash
npm run mcp:server
```

By default, the MCP server starts a local ephemeral Workbench API and proxies calls into it.

To point the MCP server at an already running Workbench deployment instead:

```bash
HEADLESS_API_URL=https://workbench.dannymcvey.com npm run mcp:server
```

## Exposed MCP Tools

### `list_tools`

Returns the discovery payload from `GET /api/run`, including:

- `supportedTools`
- `notes`
- `requestShape`
- the effective `apiUrl`

### `run_tool`

Accepts:

- `tool`
- `params`
- `state`

Returns the raw tool result shape from `POST /api/run`, including:

- `ok`
- `status`
- `output`
- `state`
- `spatial`
- `execution`
- `error` / `details` for HTTP failures

### `get_runtime_info`

Returns runtime metadata from `GET /api/state`, including supported tool keys,
spatial assumptions, workload limits, and the explicit `request-scoped` session
model. Agents can use this to understand the execution boundary before a run.

### `inspect_state`

Accepts a serialized `state` and returns it unchanged with a compact summary of
layers, per-layer feature counts, and selected feature ids. It does not create a
server-side session, persist data, or reinterpret the state's geometry.

## Current Scope

This first pass is deliberately narrow. It proves that MCP clients can:

1. discover supported headless Workbench tools
2. inspect the runtime contract, limits, and request-scoped session model
3. inspect returned layer/selection state between operations
4. run the canonical `RandomPointsTool -> BufferTool -> ExportTool` chain
5. feed returned `state` verbatim into the next call

It does **not** yet try to solve:

- persistent sessions
- higher-level app templates
- reusable UI module assembly
- public-flow guardrails beyond the existing headless API boundary
- richer domain-specific prompts or app scaffolds

Those can sit above this layer once the thin adapter is proven useful.

## Verification

The protocol-level tests exercise discovery and the canonical chained flow:

```bash
npm run test:mcp
```

The MCP result intentionally preserves the headless API's `state`, `execution`,
and `spatial` fields so clients can inspect and replay a run without learning a
second response format.
