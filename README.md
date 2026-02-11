# Spatial Workbench

Spatial Workbench is a lightweight, browser-based environment for exploring, creating, and transforming geometry.

It sits somewhere between a GIS, a sketchpad, and a playground for spatial thinking. You can draw geometry, run tools on it, inspect the resulting GeoJSON, and experiment freely without heavy setup, credentials, or opaque workflows.

This project is intentionally simple, inspectable, and extensible.

---

## What is this?

Spatial Workbench is a client-side web app built on:
- Leaflet for interactive maps
- Leaflet Draw for geometry creation
- Turf.js for spatial operations
- GeoJSON as the core data model

Everything revolves around geometry as state and tools as first-class objects.

You draw features, run tools, see what happens, and iterate.

---

## What can you do right now?

- Draw points, lines, and polygons
- View live GeoJSON for everything on the map
- Run spatial tools such as:
  - Random point generation
  - Buffers
  - Grouping by distance
  - Export to GeoJSON
- Upload external data (GeoJSON, CSV, XLSX with coordinates)
- Generate geometry using AI prompts
- Inspect tool parameters and outputs directly

Nothing is hidden. If it exists on the map, you can see its geometry.

---

## Why this exists

Most GIS tools are either:
- Extremely powerful but heavy and opaque
- Or lightweight demos that hide the mechanics

Spatial Workbench is trying to sit in the middle. The goals are:
- Make geometry tangible and explorable
- Encourage experimentation and iteration
- Support human + AI workflows without magic
- Keep spatial logic visible and debuggable

This is a place to think with geometry.

---

## Tool-driven by design

Tools are defined declaratively using a small model:
- Each tool declares its parameters
- The UI is generated automatically
- Execution updates the map and GeoJSON state
- Tool metadata can be attached to outputs

This mirrors how desktop GIS geoprocessing tools work, but in a much smaller, hackable form.

If you want to add a new spatial operation, you add a new tool.

---

## AI as a geometry producer

AI-generated features are treated the same as user-drawn geometry. They:
- Return GeoJSON
- Appear on the map
- Can be edited, buffered, exported, or analyzed

There is no special “AI layer”. AI is just another way to create shapes.

This makes it easy to experiment with human-in-the-loop spatial reasoning instead of one-shot automation.

---

## Who this is for

- GIS developers who want a lighter sandbox
- People learning spatial concepts visually
- Anyone experimenting with AI + geometry
- Developers who want a simple spatial tool framework to extend

You do not need ArcGIS, QGIS, or credentials to use this.

---

## Status

This is an experimental project. The architecture is stable enough to extend, but the UI and APIs will evolve.

Expect rough edges. That’s intentional.

---

## Roadmap ideas

Some directions this could grow into:
- Geometry comparison and scoring
- Provenance and replayable workflows
- More spatial analysis tools
- Agent-driven tool execution
- Educational “modes” for learning geometry concepts

Nothing here is locked in.

---

## Running locally

```bash
npm install
npm run build
npm start
```
