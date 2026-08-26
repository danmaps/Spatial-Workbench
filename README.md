# Spatial Workbench

Spatial Workbench is a work-in-progress platform for designing and implementing spatial tools as agent-first services.

The long-term intent is to make spatial operations easy for agents, scripts, and humans to call through clear schemas, inspectable inputs, and GeoJSON outputs. The browser workbench remains useful as an interactive surface for drawing, testing, and inspecting geometry, but it is not the center of the architecture.

This project is intentionally simple, inspectable, and extensible while the service model evolves.

## Current state

The agent-first runtime is now a working, deployed surface rather than only a
design direction:

- **Landing page:** [`workbench.dannymcvey.com`](https://workbench.dannymcvey.com)
  explains the callable-runtime model and runs a live API proof.
- **Interactive GIS:** [`/workbench-gis`](https://workbench.dannymcvey.com/workbench-gis)
  remains the browser surface for drawing, importing, inspecting, and editing.
- **Headless proof:** [`/headless-demo`](https://workbench.dannymcvey.com/headless-demo)
  runs `RandomPointsTool -> BufferTool -> ExportTool` against the deployed API.
- **Agent transport:** the thin MCP adapter exposes tool discovery and execution
  without creating a second runtime or state model.
- **AI boundary:** provider responses are normalized, transient failures have
  bounded retries/timeouts, and operational usage telemetry records provider,
  model, tokens, latency, and estimated cost without recording prompts or
  responses.

The current architecture is:

```text
browser / script / MCP client
            |
       POST /api/run
            |
   headless runtime + worker limits
            |
      tool registry + GeoJSON state
            |
 execution receipt + artifacts + spatial warnings
```

The hosted API is intentionally bounded for lightweight analysis. It is not a
general-purpose GIS processing cluster or a survey-grade measurement service.

---

## What is this?

Spatial Workbench is becoming a small spatial tool runtime built around:
- Agent-callable tool definitions
- Structured parameters and execution receipts
- Server-side service endpoints for headless runs
- GeoJSON as the core data model
- A browser workbench for visual inspection and manual testing

Current spatial assumption:
- GeoJSON coordinates are interpreted as `EPSG:4326` `longitude,latitude`
- results are intended for lightweight web/runtime analysis, not engineering, cadastral, or survey-grade measurement
- when coordinates or geometry look suspicious, the headless API now returns machine-readable spatial warnings instead of silently pretending everything is fine

Everything revolves around geometry as state and tools as first-class services.

Agents should be able to discover a tool, understand its input schema, run it, inspect the output, and chain the result into another spatial workflow. Humans should be able to use the same tools directly and see what happened.

---

## What can you do right now?

- Draw points, lines, and polygons
- View live GeoJSON for everything on the map
- Run supported tools through the headless execution API
- Expose the headless API to agents through a thin MCP server
- Run spatial tools such as:
  - Random point generation
  - Buffers
  - Grouping by distance
  - Export to GeoJSON
  - AI-generated field values
  - Text-to-numeric conversion
- Upload external data (GeoJSON, CSV, XLSX with coordinates)
- See post-import summaries and coordinate warnings after Add Data ingest
- Zoom to individual layers or the current layer selection from the Contents pane
- Open on-demand layer properties for metadata, source, geometry, and tool history
- Generate geometry using AI prompts
- Inspect tool parameters and outputs directly

Nothing is hidden. If geometry is produced, it should be inspectable as data, visible in the workbench when useful, and portable into another tool call.

---

## Why this exists

Most GIS tools are either:
- Extremely powerful but heavy and opaque
- Or lightweight demos that are difficult for agents and automation to operate

Spatial Workbench is trying to sit in the middle. The goals are:
- Make spatial tools easy for agents to call correctly
- Keep schemas, parameters, outputs, and provenance visible
- Support human + agent workflows without magic
- Make geometry tangible and explorable when visual context helps
- Keep spatial logic visible and debuggable

This is a place to build spatial capabilities that can be used by people, agents, and services.

---

## Tool-driven by design

Tools are defined declaratively using a small model:
- Each tool declares its parameters
- Tool inputs can be serialized for service execution
- Execution returns GeoJSON and metadata that agents can inspect
- The browser UI can be generated from the same definitions
- Visual execution updates the map and GeoJSON state
- Tool metadata can be attached to outputs
- Layer identity, geometry, provenance, source, and UI hooks are normalized through a canonical layer model in `js/state.js` (see `docs/layer-model.md`)
- TOC row behavior and per-layer actions follow a minimal row + ellipsis-menu model (see `docs/toc-action-model.md`)
- New tool work should follow the in-repo implementation guide (see `docs/creating-new-tools.md`)
- The hosted `POST /api/run` endpoint runs inside a bounded, worker-isolated workload envelope (see `docs/hosted-workload-envelope.md`)

This borrows from desktop GIS geoprocessing tools, but the direction is smaller, service-oriented, and agent-friendly.

If you want to add a new spatial operation, you add a tool that can eventually run as a service, not only as a UI interaction.

---

## AI as a geometry producer

AI-generated features are treated the same as user-drawn geometry. They:
- Return GeoJSON
- Appear on the map
- Can be edited, buffered, exported, or analyzed

There is no special “AI layer”. AI is just another way to create shapes.

The broader goal is agent-in-the-loop spatial reasoning: agents can propose, call, compare, and refine geometry-producing tools while humans can inspect and intervene.

---

## Who this is for

- Developers building spatial tools for agents
- GIS developers who want a lighter, inspectable runtime
- People designing human + agent spatial workflows
- Anyone experimenting with AI + geometry
- People learning spatial concepts visually

You do not need ArcGIS, QGIS, or credentials to use this.

---

## Status

This is an experimental but usable work-in-progress project. The core path is
now: discover a headless tool, submit request-scoped GeoJSON state, execute in
a bounded worker, inspect the execution receipt and spatial warnings, and pass
the returned state to the next call. The UI, APIs, and tool contracts will
continue to evolve.

Expect rough edges. That’s intentional.

---

## Next on the roadmap

The next platform work is focused on making the runtime repeatable for agents:

- Provider fallback after the normalized AI/retry/telemetry foundation
- Replayable multi-step workflows with execution receipts and artifact links
- More tool contracts with examples, preconditions, and deterministic fixtures
- Spatial join, clip/intersect, geocode/enrich, and suitability workflows
- Geometry comparison and scoring services
- Provenance and replayable workflows
- Educational “modes” for learning geometry concepts

See the open GitHub issues for the active queue. Changes should be delivered
through pull requests so the runtime, docs, tests, and deployment behavior are
reviewable together.

---

## Running locally

```bash
npm install
npm run test:headless
npm run demo:headless
npm run test:mcp
npm run build
npm start
```

For the narrow headless proof specifically:

```bash
npm run test:headless
npm run demo:headless
```

This exercises the local deterministic `RandomPointsTool -> BufferTool -> ExportTool` path and writes `artifacts/headless-demo.geojson`.

## MCP server

Spatial Workbench also includes a thin MCP server that wraps the existing headless API:

```bash
npm run mcp:server
```

By default it starts a local ephemeral Workbench API and exposes two MCP tools:

- `list_tools` -> wraps `GET /api/run`
- `run_tool` -> wraps `POST /api/run`

What those tools are for:

- `list_tools` returns the current Workbench headless tool catalog, notes, and request shape
- `run_tool` executes one supported tool against request-scoped serialized `state`

Typical MCP flow:

1. call `list_tools`
2. choose a supported Workbench tool key such as `RandomPointsTool`, `BufferTool`, or `ExportTool`
3. call `run_tool` with `tool`, `params`, and `state`
4. pass the returned `state` into the next `run_tool` call unchanged
5. inspect the returned `execution` receipt for timing, input layer ids, output layer ids, and feature counts

Example `run_tool` arguments shape:

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

The returned result includes:

- `ok`
- `status`
- `output`
- `state`
- `execution`
- `spatial`

`spatial` declares the current runtime assumptions (`EPSG:4326`, longitude/latitude ordering, Turf-based measurement model) and carries structured warnings such as projected-looking coordinates, reversed coordinate order, null geometry, or skipped features.

This is intentionally thin. The MCP layer does not reinterpret Workbench state or invent session semantics in v1; it simply exposes the existing headless API seam to MCP clients.

To point it at a live deployment instead:

```bash
HEADLESS_API_URL=https://workbench.dannymcvey.com npm run mcp:server
```

To verify the MCP layer locally:

```bash
npm run test:mcp
```

See `docs/mcp-server.md` for the first-pass scope and contract.

## Production / service mode

For a durable deployment, build the frontend bundle and run the Express server directly instead of `nodemon`:

```bash
npm install
npm run build
PORT=3003 npm run start:prod
```

Recommended environment variables:

```bash
PORT=3003
CORS_ORIGINS=https://workbench.dannymcvey.com
# Optional fallback key for server-side AI requests
# OPENAI_API_KEY=...
```

A `systemd --user` service can wrap the production start command and restart it automatically on failure.

## AI provider configuration

The hosted AI routes are:

- `POST /api/ai_structured` for structured JSON responses
- `POST /api/ai_geojson` for GeoJSON generation
- `GET /api/providers` for available provider/model metadata

The built-in provider is Ollama. OpenAI is supported directly, and OpenRouter
provides the unified hosted gateway for model/provider routing. Direct OpenAI
requests use `OPENAI_API_KEY`; OpenRouter requests use `OPENROUTER_API_KEY`.
AI request behavior can be tuned with:

```bash
AI_REQUEST_TIMEOUT_MS=30000
AI_MAX_RETRIES=2
# Optional OpenRouter model fallback chain, comma-separated
OPENROUTER_FALLBACK_MODELS=anthropic/claude-3.5-sonnet,google/gemini-2.0-flash
# Optional JSON pricing overrides for usage telemetry
AI_PRICING_JSON='{"openai":{"gpt-4o":{"input":0.0025,"output":0.01}}}'
```

See [`docs/ai-provider-contract.md`](docs/ai-provider-contract.md) for the
normalized response, OpenRouter integration, retry/error categories, and
privacy-safe usage telemetry. OpenRouter-reported usage cost is preferred;
local pricing is only a fallback for direct providers or missing provider data.

## Development checks

The main verification commands are:

```bash
npm test                         # full Jest suite
npm run test:headless            # headless/runtime guardrails
npm run test:mcp                 # MCP protocol coverage
npm run spec:check               # detect tool-spec drift
npm run build                    # browser bundle
```

The hosted headless API also enforces request size, feature, vertex,
concurrency, timeout, and rate limits. See
[`docs/hosted-workload-envelope.md`](docs/hosted-workload-envelope.md).
