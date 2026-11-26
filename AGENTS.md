# AGENTS.md — Spatial Workbench

Instructions and operational guardrails for coding agents working in this repository.

---

## 1. Runtime & Environment

- **Node version:** Requires Node `>=24.22.1 <25` (enforced by `scripts/check-node-runtime.js` and `node-runtime.test.js`).
  - If the default shell `node` is older, prefix commands with the nvm Node 24 path (e.g. `PATH=/home/danny/.nvm/versions/node/v24.22.1/bin:$PATH`).
- **Branch discipline:** Work cleanly against `main` (or PR branches that are deleted on merge). Avoid leaving stale local branches or temporary worktrees behind.

---

## 2. Build, Spec & Test Workflow

Run these checks before committing and pushing:

1. **Tool specs & docs (required whenever tools or parameters change):**
   ```bash
   npm run spec:update
   npm run spec:check
   ```
   This regenerates `js/tools/specs.json` and `tool-docs/*.html`. CI enforces `npm run spec:check`.
2. **Frontend bundle (required whenever `js/**` changes):**
   ```bash
   npm run build
   ```
   Updates `public/dist/bundle.js` used by `/workbench-gis`.
3. **Tests:**
   ```bash
   npm test -- --runInBand
   ```
   Always run the full Jest suite (including `js/ui/layer-interactions.integration.test.js`, `server.headless.test.js`, `server.guardrails.test.js`, and `mcp-server.test.js`) before pushing.

---

## 3. Local Production Service Restart (Important)

On the deployment host, Spatial Workbench is served by a user-level systemd service (`spatial-workbench.service`) on port `3003` behind `https://workbench.dannymcvey.com/`.

**After pushing any change that affects `server.js`, HTML/CSS, `tool-docs/`, or `public/dist/bundle.js`, restart the service and verify it is active:**

```bash
systemctl --user restart spatial-workbench.service && systemctl --user is-active spatial-workbench.service
```

---

## 4. Architecture & Codebase Conventions

- **Dual-surface tools (`js/tools/`):**
  - New tools should follow `docs/creating-new-tools.md` and register in `js/runtime/toolRegistry.js` (and `js/headless-runtime.js` when `headlessSupported = true`).
  - Any tool that overrides `renderUI(paramValues = {})` **must** accept `paramValues = {}`, forward it to `super.renderUI(paramValues)`, and preserve selected dropdown/checkbox values across executions.
- **Layer state & symbology (`js/state.js`, `js/ui/layer-symbology.js`):**
  - Keep `js/ui/layer-symbology.js` pure (no Leaflet or DOM imports).
  - Use `state.getLayerSymbology()`, `state.setLayerSymbology()`, `state.resetLayerSymbology()`, and `state.getLayerSymbologyDomain()` for `swb.style.v1` styling (see `docs/layer-symbology.md`).
  - `ExportTool` persists `symbology` in GeoJSON exports and `AddDataTool` / `state.applyResult()` restores it on import.
- **Static & directory routes (`server.js`):**
  - `express.static(__dirname, { index: false })` is intentionally used so root `/` serves `landing.html` rather than `index.html`. Any directory URL (e.g. `/workbench-gis/`, `/agent-ui-demo/`, `/tool-docs/`) must have an explicit Express route.
- **Hosted workload guardrails (`server.js`):**
  - `POST /api/run` executes inside worker threads with bounded feature/vertex/layer counts, timeouts, and parameter limits (e.g. `DEFAULT_MAX_BUFFER_DISTANCE = 500`). See `docs/hosted-workload-envelope.md`.
- **Agent UI components (`js/components/`):**
  - Opinionated GIS components (`swb.ui.v0`) and the OpenUI Lang adapter live in `js/components/` and are served at `/agent-ui-demo` and `/api/agent-ui/catalog` (see `docs/agent-ui-components-plan.md`).
- **Documentation:**
  - Keep `README.md`, `docs/feature-profiles.md`, and relevant `docs/*.md` specs synchronized with user-visible changes.
