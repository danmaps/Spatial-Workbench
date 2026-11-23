# UX Reference Study, Mobile Strategy, and Basemap Architecture

This document records the product and UX decisions for [Issue #68](https://github.com/danmaps/Spatial-Workbench/issues/68) (Mobile Strategy), [Issue #71](https://github.com/danmaps/Spatial-Workbench/issues/71) (GIS Web App UX Reference Study), and [Issue #14](https://github.com/danmaps/Spatial-Workbench/issues/14) (OpenFreeMap & Basemap Evaluation).

---

## 1. Mobile Strategy Decision: Adaptive Parity (#68)

### The Question
Should Spatial Workbench treat mobile viewports as a stripped-down demo mode (**Constrained Mobile Mode**) or support the core desktop workflows through responsive interaction patterns (**Adaptive Parity**)?

### The Decision: Adaptive Parity with Form-Factor-Specific Surfaces
Spatial Workbench adopts **Adaptive Parity**: all core workflows—layer inspection, visibility toggling, attribute browsing, running spatial tools, and inspecting receipts/GeoJSON—are supported on mobile viewports, but dense desktop surfaces adapt into mobile-native primitives rather than shrinking a desktop grid onto a phone screen.

| Workflow Surface | Desktop Behavior (`> 860px`) | Mobile / Small-Screen Behavior (`<= 860px`) | Implementation Seam |
| :--- | :--- | :--- | :--- |
| **Workspace Navigation** | Three-pane split layout (`Layers TOC` + `Map & Attribute Drawer` + `Tools & Data Sidebar`). | Single active surface switched via the top `.mobile-bar` (`Map \| Tools \| Layers \| Data`) with an explicit `Return to Map` action. | `index.html`, `public/js/mobile.js` |
| **Attribute Inspection** | Collapsible bottom drawer (`#desktopAttributeDrawer`) with an inline-editable tabular grid. | Stacked feature record cards (`.attribute-card`) with progressive disclosure, `All` vs. `Selected` filtering, and 1-tap `Zoom` to feature. | `js/ui/attribute-view.js`, `js/ui/desktop-attribute-drawer.js`, `js/app.js` |
| **TOC Layer Actions** | Quiet row with hover/focus-revealed ellipsis trigger (`.layer-menu-trigger`) and collapsible parent-child lineage trees. | Always-visible touch-friendly eye visibility toggle, group chevron, and ellipsis menu trigger (`pointer: coarse`). | `docs/toc-action-model.md`, `js/app.js` |
| **Agent-Composed UI (`swb.ui.v0`)** | Supports both `CompactCard` (`compact`) and split `ReviewWorkspace` (`workspace`) layouts. | `ReviewWorkspace` collapses cleanly to a single column, and `SpatialResult` renders stacked attribute cards automatically. | `js/components/renderers.js`, `public/css/agent-ui-demo.css` |

### Explicit Mobile Guardrails
* **Map interactions:** Default map click mode (`Select` vs. `Inspect`) is explicitly toggled in the TOC header so touch panning never accidentally mutates feature selection.
* **Precision vertex editing:** Fine-grained multi-vertex polygon reshaping via Leaflet Draw remains a desktop-first workflow; mobile users can still draw points/shapes, select features, run all geoprocessing tools, inspect attributes, and export GeoJSON.

---

## 2. GIS Web App UX Reference Study (#71)

To keep Spatial Workbench **minimal, inspectable, and obvious** rather than drifting into an enterprise-chaotic control cockpit, we evaluated six reference mapping applications.

### Reference App Breakdown

| Reference App | What It Does Best | Patterns Borrowed in Spatial Workbench | Patterns Explicitly Avoided |
| :--- | :--- | :--- | :--- |
| **1. geojson.io** | Immediate, zero-friction mental model connecting map geometry and raw GeoJSON text. | Live syntax-highlighted GeoJSON inspector (`#DataContent`) synced directly with map layers; zero-login startup. | Exposing raw JSON editing as the *only* way to inspect feature attributes or provenance. |
| **2. Felt** | Calm typography, lightweight side panels, and approachable spatial tools that don't overwhelm the canvas. | Quiet TOC rows (`docs/toc-action-model.md`) where secondary actions live inside an on-demand ellipsis menu rather than an icon toolbar on every row. | Collaborative commenting/annotation chrome that distracts from deterministic tool execution. |
| **3. kepler.gl** | Progressive disclosure for data import and multi-layer analysis workflows. | Post-import summaries with coordinate warnings (`AddDataTool`) and collapsible parent-child derived layer grouping (`state.getTocLayerHierarchy()`). | Deep multi-tab styling/filtering sidebars that hide the underlying data transformations. |
| **4. Mapbox Studio** | Restrained dark-ui framing, crisp visual hierarchy, and tabular numeral rhythm around a central canvas. | High-contrast dark instrument palette, `IBM Plex Sans` + `IBM Plex Mono` pairing, and `tabular-nums` for coordinates, timings, and feature counts. | Complex style-specification trees unrelated to geoprocessing. |
| **5. Google My Maps** | Approachable entry point and obvious layer/feature mental model for non-GIS specialists. | Bundled 1-click sample data in `Add Data`, human-readable default layer naming (`Buffer of Study Parcels`), and clear `Select` vs. `Inspect` modes. | Oversimplified geometry handling that hides CRS assumptions or tool parameters. |
| **6. ArcGIS Map Viewer** | Familiar GIS affordances: layer visibility toggles, attribute table drawer, zoom-to-selection, and geoprocessing tool forms. | Eye visibility toggles, collapsible bottom attribute drawer on desktop, selection-aware tool targeting (`targetScope`), and tool documentation links. | Enterprise ribbon bloat, deeply nested modal dialogs, and opaque background state mutations. |

### Core UX Rules Derived from This Study
1. **The map and the receipt share top billing:** Every tool run must update both visual geometry and an inspectable execution receipt (`durationMs`, `featureCounts`, `target`, `spatial.warnings`).
2. **One primary action per row or form:** TOC rows select on click; secondary actions live in the ellipsis menu. Tool forms have one explicit `Execute` action gated by schema validation.
3. **Lineage over flat clutter:** Derived layers nest under their parent source layer by default so multi-step chains (`Import -> Buffer -> Compare`) remain legible at a glance.

---

## 3. Basemap Architecture & OpenFreeMap Evaluation (#14)

### Why OpenFreeMap Was Evaluated
[OpenFreeMap](https://openfreemap.org/) (`github.com/hyperknot/openfreemap`) provides free, public, API-key-free vector tile hosting (`https://tiles.openfreemap.org/styles/liberty`, `positron`, `bright`) backed by OpenStreetMap data.

### Technical Trade-Offs for Spatial Workbench
1. **Vector Tiles (MapLibre GL) vs. Raster Tiles (Leaflet):**
   * OpenFreeMap's primary hosted endpoints serve **Mapbox/MapLibre GL vector style JSON** and PBF vector tiles (`tiles.openfreemap.org/planet/...`).
   * Spatial Workbench's interactive browser editor (`/workbench-gis`) is currently built on **Leaflet + Leaflet Draw** (`L.tileLayer`, `L.Control.Draw`, `L.GeoJSON`), which consumes standard `{z}/{x}/{y}.png` raster tiles natively without requiring WebGL or a MapLibre GL plugin bridge.
2. **Zero-Key Basemap Resilience Implemented Now:**
   * Spatial Workbench already works **100% without an API key** using public CARTO Dark Matter (`dark_all`), CARTO Positron Light (`light_all`), and standard OpenStreetMap (`osm`) raster tiles.
   * In [Issue #63](https://github.com/danmaps/Spatial-Workbench/issues/63), we centralized basemap selection inside the persisted Settings panel (`js/ui/ai-settings.js` -> `BASEMAP_OPTIONS` and `addCartoBasemap()` in `js/app.js`).
3. **Future Path for OpenFreeMap Vector Styles:**
   * Because the `swb.ui.v0` component architecture (`docs/agent-ui-components-plan.md`) cleanly decouples the **Map Renderer Adapter** from the **Headless GIS Component Contracts**, any future MapLibre GL renderer adapter (or GeoLibre plugin integration) can point directly at `https://tiles.openfreemap.org/styles/liberty` or `https://tiles.openfreemap.org/styles/positron` with zero API keys and zero changes to Spatial Workbench's tool or state contracts.
