# Spatial Workbench

Spatial Workbench is a work-in-progress platform for designing and implementing spatial tools as agent-first services.

The long-term intent is to make spatial operations easy for agents, scripts, and humans to call through clear schemas, inspectable inputs, and GeoJSON outputs. The browser workbench remains useful as an interactive surface for drawing, testing, and inspecting geometry, but it is not the center of the architecture.

This project is intentionally simple, inspectable, and extensible while the service model evolves.

---

## What is this?

Spatial Workbench is becoming a small spatial tool runtime built around:
- Agent-callable tool definitions
- Structured parameters and execution receipts
- Server-side service endpoints for headless runs
- GeoJSON as the core data model
- A browser workbench for visual inspection and manual testing

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

This is an experimental, work-in-progress project. The architecture is moving from browser-centered exploration toward agent-first spatial services, so the UI, APIs, and tool contracts will continue to evolve.

Expect rough edges. That’s intentional.

---

## Roadmap ideas

Some directions this could grow into:
- Tool discovery and schema publication for agents
- More complete headless execution coverage
- MCP or similar adapters for agent runtimes
- Geometry comparison and scoring services
- Provenance and replayable workflows
- More spatial analysis tools
- Educational “modes” for learning geometry concepts

Nothing here is locked in.

---

## Running locally

```bash
npm install
npm run test:headless
npm run demo:headless
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

To point it at a live deployment instead:

```bash
HEADLESS_API_URL=https://workbench.dannymcvey.com npm run mcp:server
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
