# Concept: Serialized Spatial Expressions

## Status

Concept only. This document proposes a portable, inspectable representation for explicit Spatial Workbench tool chains. It does not define a committed public syntax or API.

## Motivation

Spatial Workbench is increasingly shaped as a dependable execution engine rather than an agent or planner. The caller decides what to do. Workbench validates and executes spatial tools, carries request-scoped state, applies runtime guardrails, and returns structured receipts.

That boundary creates an opportunity for a small intermediate representation between an intelligent caller and the execution engine.

A useful analogy is a domain-specific notation format such as AlphaTex: a generative system can produce a compact serialized expression, while a deterministic engine interprets that expression and renders or executes it. The important idea is not the particular syntax. It is the existence of an inspectable artifact between model intent and runtime behavior.

For Spatial Workbench, a serialized spatial expression could represent an already-decided sequence of tool calls:

```text
user goal
   |
agent / human caller
   |
serialized spatial expression
   |
validate + resolve references
   |
Spatial Workbench execution engine
   |
registered tools
   |
state + artifacts + receipts
```

The expression is a plan artifact, not a planner.

See also:

- [`execution-engine-reframing.md`](execution-engine-reframing.md)
- [`headless-api.md`](headless-api.md)
- [`dataset-handle-architecture.md`](dataset-handle-architecture.md)

## Core idea

A serialized spatial expression should describe **what explicit tool calls to execute and how outputs from earlier calls feed later calls**.

It should not contain reasoning, natural-language planning, arbitrary code, or hidden workflow state.

The current headless demo already has the essential semantics:

1. run `RandomPointsTool`
2. pass returned state forward
3. capture the created layer id
4. run `BufferTool` against that layer
5. capture the buffered layer id
6. run `ExportTool`
7. retain each execution receipt

Today that chain is expressed as JavaScript around repeated `POST /api/run` calls. A serialized expression would make the same chain portable and inspectable.

## Example

A human-friendly sketch might look like this:

```text
@spatial-workbench 0.1

state {
  bbox: [-118.5, 33.5, -118.2, 33.8]
}

points = RandomPointsTool {
  "Points Count": 5,
  "Inside Polygon": false
}

buffers = BufferTool {
  "Input Layer": $points.state.added[0].id,
  "Distance": 0.5,
  "Units": "kilometers"
}

export = ExportTool {
  "Layer": $buffers.state.added[0].id,
  "Format": "GeoJSON"
}
```

This is intentionally close to the existing tool contract. The expression does not invent a buffer operation of its own. It names a registered Workbench tool and supplies that tool's parameters.

The runtime would conceptually compile the expression into the same calls already supported by the headless API:

```text
expression
   |
parse
   |
validate tool names + params + references
   |
POST /api/run RandomPointsTool
   |
resolve $points reference
   |
POST /api/run BufferTool
   |
resolve $buffers reference
   |
POST /api/run ExportTool
   |
composite receipt
```

## Canonical representation

The first implementation should probably use JSON as the canonical serialization, even if a smaller text syntax is added later for copy/paste ergonomics.

A possible JSON shape:

```json
{
  "version": "0.1",
  "state": {
    "bbox": [-118.5, 33.5, -118.2, 33.8]
  },
  "steps": [
    {
      "id": "points",
      "tool": "RandomPointsTool",
      "params": {
        "Points Count": 5,
        "Inside Polygon": false
      }
    },
    {
      "id": "buffers",
      "tool": "BufferTool",
      "params": {
        "Input Layer": { "$ref": "points.state.added[0].id" },
        "Distance": 0.5,
        "Units": "kilometers"
      }
    },
    {
      "id": "export",
      "tool": "ExportTool",
      "params": {
        "Layer": { "$ref": "buffers.state.added[0].id" },
        "Format": "GeoJSON"
      }
    }
  ]
}
```

Advantages of making JSON canonical first:

- it maps directly to the existing `/api/run` contract
- agents already generate structured JSON well
- schema validation is straightforward
- no parser design is required for the first prototype
- expressions can be stored, diffed, hashed, replayed, and tested
- a concise text format can later compile into the same JSON structure

The text form should be treated as syntax sugar over a stable expression model, not as a separate execution system.

## Execution semantics

A serialized expression runner should have simple and deterministic semantics.

### 1. Explicit tool selection

Every step names a registered tool key such as `BufferTool` or `ExportTool`.

The expression runner does not choose tools from natural language.

### 2. Sequential state flow

By default, each successful step receives the `state` returned by the previous step.

This mirrors the current headless chaining model and avoids introducing a second state system.

### 3. Explicit references

A later step may reference structured data from an earlier step using a small reference mechanism such as:

```json
{ "$ref": "buffers.state.added[0].id" }
```

References should only resolve against completed prior steps and explicitly declared initial inputs.

The runner should fail validation for forward references, missing paths, or ambiguous references.

### 4. Existing tool validation remains authoritative

Expression validation can catch malformed structure and obviously invalid references, but individual Workbench tool contracts remain the source of truth for tool parameters and domain validation.

The expression layer must not duplicate tool logic.

### 5. Stop on failure by default

If a step fails, later steps should not run unless a future version explicitly defines another policy.

The composite result should retain the failed step's normalized error and all receipts from completed steps.

### 6. No hidden retry semantics

Transient retries remain execution-engine policy as described in the execution-engine reframing. The expression runner should not silently replan, substitute tools, or change parameters.

### 7. Guardrails apply to the whole run

Each tool execution remains subject to the current hosted workload envelope. A composite expression runner should also impose limits such as:

- maximum number of steps
- maximum total wall-clock duration
- maximum serialized expression size
- maximum cumulative output size
- cancellation propagation

An expression should never become a way to bypass per-tool workload limits.

## Receipts and provenance

A major benefit of the expression layer is reproducibility.

A composite receipt could include:

```json
{
  "ok": true,
  "expression": {
    "version": "0.1",
    "hash": "sha256:...",
    "stepCount": 3
  },
  "steps": [
    {
      "id": "points",
      "tool": "RandomPointsTool",
      "ok": true,
      "execution": {}
    },
    {
      "id": "buffers",
      "tool": "BufferTool",
      "ok": true,
      "execution": {}
    },
    {
      "id": "export",
      "tool": "ExportTool",
      "ok": true,
      "execution": {}
    }
  ],
  "state": {},
  "artifacts": []
}
```

The child `execution` objects should be the same receipts returned by `/api/run`, not a competing receipt format.

Useful provenance fields may eventually include:

- expression version
- normalized expression hash
- Workbench version or commit
- tool catalog/schema version or hash
- initial dataset handles
- per-step input and output layer ids
- produced artifacts
- spatial warnings
- provider/model usage for AI-backed tools

The goal is to make a run answer three questions clearly:

1. What explicit expression was executed?
2. What happened at each step?
3. What state and artifacts were produced?

## Dataset handles

Serialized expressions should work with both existing state modes.

Small workflows can carry inline GeoJSON in initial state. Larger workflows can use `dataset://...` references through the existing dataset-handle architecture.

For example:

```json
{
  "version": "0.1",
  "state": {
    "layers": [
      {
        "id": "parcels",
        "datasetRef": "dataset://abc123"
      }
    ]
  },
  "steps": [
    {
      "id": "buffered",
      "tool": "BufferTool",
      "params": {
        "Input Layer": "parcels",
        "Distance": 500,
        "Units": "meters"
      }
    }
  ]
}
```

The expression format should not invent another artifact or dataset storage mechanism. It should point at the same request-scoped state and handles already understood by the runtime.

## Why this is not agent orchestration

The distinction is important.

An agent might receive:

> Generate five random points, buffer them by half a kilometer, and export the result.

The agent may decide that the correct explicit plan is:

```text
RandomPointsTool -> BufferTool -> ExportTool
```

It can then serialize that plan into an expression.

Spatial Workbench executes the supplied expression exactly within its contracts and limits.

Workbench does **not**:

- infer the workflow from the natural-language goal
- decide whether buffering is the right analysis
- choose a different tool because a result looks surprising
- add steps that were not in the expression
- rewrite parameters to improve the analysis
- maintain conversational memory around the run

The agent plans. The serialized expression records the plan. The engine executes it.

## Why not generate Python?

Python remains valuable for open-ended GIS development, but it is a poor default intermediate representation for a constrained execution engine.

A serialized expression can be:

- validated before execution
- limited to registered tools
- inspected by a human
- replayed without arbitrary code execution
- mapped consistently across HTTP, CLI, MCP, and browser clients
- tied directly to structured receipts
- portable across future backend implementations

The same expression could eventually be executed by a Turf-backed runtime today and another backend later, as long as the named Workbench tool contract remains stable.

That portability is more important than hiding the current implementation language.

## UI implications

A human-facing client could expose a **Copy expression** action after an agent or UI assembles a workflow.

That copied artifact could be:

- pasted into a CLI runner
- attached to a bug report
- committed to Git
- used as a regression fixture
- replayed against a newer Workbench version
- modified manually and rerun
- compared with another agent-generated plan

A future UI could show both the friendly workflow and the serialized expression, similar to viewing generated SQL behind a query builder.

The serialized form becomes the inspectable seam between generative planning and deterministic execution.

## Transport model

The expression should not be coupled to one transport.

A first prototype could be entirely client-side:

```text
expression file
   |
CLI / client parser
   |
repeated POST /api/run calls
```

This is the lowest-risk implementation because it requires no new server execution semantics.

If the format proves useful, a future server endpoint could accept a complete expression and return a composite receipt:

```text
POST /api/expressions/run
```

That endpoint should still delegate every step to the canonical execution path rather than create a second tool runtime.

MCP could expose the same capability later, but agents should remain free to call individual tools directly. Serialized expressions are an additional execution surface, not a replacement for tool discovery and direct calls.

## Initial scope

A useful v0 should be intentionally small.

Include:

- versioned JSON document
- initial request-scoped state
- ordered list of registered tool calls
- unique step ids
- references to prior structured outputs/state
- sequential state propagation
- stop-on-failure behavior
- composite receipt containing normal per-step receipts
- schema validation
- overall step and runtime limits

Do not include yet:

- loops
- conditional branches
- parallel execution
- natural-language statements
- arbitrary JavaScript or Python
- user-defined functions
- dynamic tool discovery during execution
- automatic tool substitution
- agent reasoning traces
- long-lived sessions
- a new dataset storage system

Those features would turn a small execution representation into a workflow language or agent runtime before the basic value has been demonstrated.

## Prototype path

A small proof of concept could reuse the existing `RandomPointsTool -> BufferTool -> ExportTool` demo.

### Phase 1: JSON fixture

Add an expression fixture representing the current demo chain.

For example:

```text
examples/random-points-buffer-export.swx.json
```

### Phase 2: runner

Add a thin client-side runner such as:

```text
scripts/run-expression.js examples/random-points-buffer-export.swx.json
```

The runner should:

1. validate the expression document
2. call `GET /api/run` for the executable tool catalog
3. verify all named tools are advertised
4. execute each step through `POST /api/run`
5. propagate returned state
6. resolve references
7. collect the existing execution receipts
8. print or save one composite receipt

### Phase 3: replay test

Add a deterministic test showing that a saved expression executes the same tool sequence and produces the expected receipt structure.

The first success criterion is not sophisticated syntax. It is proving that an explicit spatial plan can be serialized, inspected, replayed, and executed through the existing engine without moving planning into Workbench.

## Design questions

Questions worth answering before treating this as a public contract:

1. Should JSON remain the only supported format initially, or is a concise text syntax valuable enough to prototype early?
2. What should the stable reference syntax be for values produced by prior steps?
3. Should expressions reference raw response paths, or should tools expose a smaller set of named outputs for chaining?
4. Should the expression record exact tool schema/catalog hashes for strict replay, or only a Workbench version?
5. Should composite execution be client-side only, server-side only, or both?
6. How should dataset-handle expiration affect replay semantics?
7. What overall workload limits are appropriate for a multi-step expression?
8. Should the expression be able to declare expected output types so validation can catch broken chains before execution?

The third question may be especially important. A reference such as:

```text
$buffers.state.added[0].id
```

works, but it couples the expression to response-envelope structure. A future tool contract might instead expose stable named outputs such as:

```text
$buffers.outputs.layerId
```

That would make expressions more readable and more durable.

## Decision test

A serialized-expression feature belongs in Spatial Workbench if it strengthens the execution-engine role:

> Can an external caller hand Workbench an explicit, inspectable spatial plan and have it executed reliably, safely, and reproducibly without Workbench deciding what the plan should be?

If yes, this is a natural extension of the current architecture.

## Short version

Spatial Workbench already has the pieces of a small spatial execution language: registered tools, structured parameters, request-scoped state, dataset handles, deterministic execution, and receipts.

A serialized spatial expression would make those pieces portable.

**Agent plans. Expression records. Engine executes. Tools do the work.**
