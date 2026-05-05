# Creating New Tools in Spatial Workbench

This guide explains how to add a new tool to Spatial Workbench in a way that fits the current architecture.

The short version:
- tools should be small, inspectable, and result-oriented
- tools should prefer `run(params, context)` as the real execution seam
- UI is a wrapper around execution, not the execution itself
- outputs should become one logical result layer when appropriate
- tools that act on layers/features should honor selection by default

---

## 1. Understand the current tool model

Tools are classes built on top of `js/models/Tool.js`.

A typical tool has:
- a constructor with a name + parameters
- optional UI generated from those parameters
- a `run(params, context)` method that performs the actual work
- an optional result handled through the common result pipeline

Important pieces:
- `Tool.getSpec()` → machine-readable tool metadata
- `Tool.run(params, context)` → core execution path
- `Tool.execute()` → UI wrapper that collects DOM params and calls `run()`

If you are designing a tool now, think of `run()` as the real contract.

---

## 2. Decide what kind of tool you are building

Most new tools fall into one of these buckets:

### A. Result-producing spatial tools
Examples:
- Buffer
- Random Points
- future Clip / Erase

These should usually:
- read one or more input layers/features
- produce a derived GeoJSON result
- return one logical output layer containing many features when appropriate

### B. Selection / targeting tools
Examples:
- Select by Attribute
- future box/lasso selection helpers

These should usually:
- update centralized selection state
- not necessarily create a new output layer

### C. Export / artifact tools
Examples:
- Export
- future report/download tools

These should usually:
- return a `download` result or other machine-readable artifact
- avoid pretending to create a new map layer unless they really do

### D. Data-ingest tools
Examples:
- Add Data

These should usually:
- normalize external data into the common layer model
- attach import summaries/warnings when useful

---

## 3. Follow the default targeting rule

For tools that act on layers or features, the default rule is:

> If there is a relevant selection on the target layer, operate on the selection. Otherwise, operate on the whole layer.

This is now the intended product behavior.

Do **not** make selection handling a weird special case unless the tool truly requires it.

Useful existing reference:
- `js/tools/targeting.js`

That helper is the first place to look before inventing your own targeting logic.

---

## 4. Keep outputs dataset/result-oriented

One logical dataset or operation result should map to **one layer**.

Good:
- buffer 10 features → one output layer containing 10 buffered features
- random points → one output layer containing many points
- clip many features → one output layer containing clipped results

Bad:
- one sibling layer per output feature unless that is explicitly the product behavior

Relevant background:
- `docs/layer-model.md`

---

## 5. Create the tool file

Add a new file under:

- `js/tools/YourToolName.js`

Typical shape:

```js
const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult } = require('../state');

class ExampleTool extends Tool {
  constructor(map) {
    super(
      'Example Tool',
      [
        new Parameter('Layer', 'Target layer', 'dropdown', ''),
        new Parameter('Distance', 'Buffer distance', 'float', 100)
      ],
      'Short description of what this tool does.',
      map
    );
  }

  async run(params, context) {
    // Read params
    // Resolve target layer / selection
    // Produce GeoJSON result

    const result = applyResult({
      addGeojson: {
        type: 'FeatureCollection',
        features: [],
        toolMetadata: {
          name: this.name,
          params,
          timestamp: new Date().toISOString()
        }
      }
    });

    this.setStatus(0, 'Example tool completed.');
    return result;
  }
}

module.exports = { ExampleTool };
```

That example is intentionally simplified. Look at existing tools before copying it literally.

---

## 6. Prefer existing runtime/state seams

Before inventing new plumbing, check these existing seams:

- `js/state.js`
  - layer registration
  - canonical layer summaries
  - centralized selection state
  - result application
- `js/tools/targeting.js`
  - selection-aware target resolution
- `js/headless-runtime.js`
  - request-scoped execution outside the browser UI

If your tool can fit those seams, use them.

---

## 7. Make the tool headless-friendly when possible

Spatial Workbench now has a first-pass headless execution API.

That means new tools should **prefer** being runnable outside the browser UI when practical.

Good signs:
- logic lives in `run(params, context)`
- no dependency on DOM state during execution
- inputs/outputs are plain data where possible

Avoid baking execution logic into:
- click handlers
- DOM-only state
- localStorage-only assumptions

If browser-only behavior is unavoidable, be explicit about it.

Relevant docs:
- `docs/headless-api.md`

---

## 8. Add the tool to the visible tool list

If the tool is ready for users, add it to the tool registry in `js/app.js`.

There is currently a list like:

```js
const toolNames = [
  'RandomPointsTool',
  'BufferTool',
  'ExportTool',
  'GenerateAIFeatures',
  'AddDataTool'
];
```

Only add the tool here if it is actually ready to be visible in the UI.

If it is experimental, incomplete, or confusing, do **not** surface it yet.

---

## 9. Think about result metadata and provenance

When a tool creates output, it should usually attach `toolMetadata`.

Useful fields include:
- `name`
- `params`
- `timestamp`
- target/selection metadata where relevant
- parent layer references where relevant

This helps:
- layer properties
- provenance/history
- future headless/CLI/MCP use

---

## 10. Add tests that prove behavior, not just existence

At minimum, add focused tests near the tool or runtime path.

Useful test categories:
- happy-path tool execution
- selected-features behavior vs whole-layer fallback
- result shape
- result layer count (one logical result layer)
- headless/runtime execution if applicable
- validation/failure behavior if relevant

Good places to look:
- `js/tools/BufferTool.test.js`
- `js/tools/AddDataTool.test.js`
- `js/headless-runtime.test.js`
- `server.headless.test.js`

Do not add tests that only inflate count without proving product behavior.

---

## 11. Run the right checks

Typical checks before pushing:

```bash
npm test -- --runInBand
npm run build
```

If you only changed a focused tool, also run its targeted tests first.

---

## 12. Questions to ask before opening a new tool PR/commit

- Does this tool operate on selection by default when it should?
- Does it produce one logical output layer when appropriate?
- Does it fit the canonical layer model?
- Is the output inspectable in layer properties / attribute views?
- Could the execution path work headlessly later?
- Is it ready to be visible in the tool picker, or should it stay hidden for now?

---

## 13. Good examples in the current codebase

Useful references:
- `js/tools/BufferTool.js`
- `js/tools/RandomPointsTool.js`
- `js/tools/ExportTool.js`
- `js/tools/AddDataTool.js`
- `js/tools/targeting.js`
- `js/headless-runtime.js`
- `docs/layer-model.md`
- `docs/headless-api.md`

---

## 14. Product philosophy reminder

A new tool should feel like it belongs in Spatial Workbench.

That usually means:
- minimal UI
- obvious inputs
- inspectable outputs
- boring internal contracts
- no hidden magic if it can be avoided

If the tool is powerful but confusing, simplify it.
If it is clear but too coupled to UI state, refactor it.
If it creates lots of weird sibling layers, fix that.

The goal is not just “more tools.”
The goal is a small system where tools compose cleanly.
