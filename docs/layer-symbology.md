# Declarative Layer Symbology (`swb.style.v1`)

Spatial Workbench includes a lightweight, MapLibre/GeoLibre-inspired declarative symbology system so any layer in `/workbench-gis` (drawn, imported, or tool-derived) can be styled using a portable JSON contract that is independent of Leaflet and preserved across GeoJSON exports.

---

## Architecture

```text
  TOC "..." menu -> Style layer (js/ui/layer-style-editor.js)
                          |
                  swb.style.v1 JSON spec
                          |
                          v
        Pure Resolver & Domain Engine (js/ui/layer-symbology.js)
        - validateSymbology(spec)
        - getSymbologyDomain(geojson, spec)
        - createSymbologyResolver(spec, domain)
                          |
          +---------------+---------------+
          |                               |
          v                               v
   Map Rendering (js/state.js)     TOC Legend (js/app.js)
   - setLayerSymbology()           - createStyleLegend()
   - resetLayerSymbology()         - Swatches, numeric range,
   - Path setStyle() / divIcon       and fallback indicator
   - drawStyleGuard (edit-safe)
```

---

## Style Contract (`swb.style.v1`)

Each logical layer stores at most one optional `symbology` object:

```json
{
  "version": "swb.style.v1",
  "mode": "categorical",
  "field": "zone",
  "palette": "default",
  "ramp": "blue",
  "fallbackColor": "#94a3b8",
  "paint": {
    "fillColor": "#3388ff",
    "color": "#3388ff",
    "fillOpacity": 0.5,
    "opacity": 1,
    "weight": 3,
    "radius": 7
  }
}
```

### Supported Modes

| Mode | Required Fields | Behavior |
| --- | --- | --- |
| `single` | none | Uniform `paint` (`fillColor`, `color`, `fillOpacity`, `opacity`, `weight`, `radius`). |
| `categorical` | `field` | Deterministically maps distinct scalar values (`string`, finite `number`, `boolean`) sorted lexicographically to a named palette (`default`, `vivid`). Feature order and selection do not affect assigned colors. Missing/null/non-scalar values use `fallbackColor`. |
| `graduated` | `field` | Computes `[min, max]` across all finite numeric values in the layer (including `0`) and linearly interpolates across a named color ramp (`blue`, `viridis`). Constant fields map to the ramp midpoint (`0.5`). Missing or non-numeric values use `fallbackColor`. |

### Built-in Palettes & Ramps

- **Categorical Palettes (`PALETTES`):**
  - `default`: 10-color dark-basemap palette (`#38bdf8`, `#f59e0b`, `#ec4899`, `#34d399`, `#a78bfa`, `#fb7185`, `#facc15`, `#2dd4bf`, `#60a5fa`, `#fb923c`)
  - `vivid`: 8-color high-contrast palette
- **Graduated Ramps (`RAMPS`):**
  - `blue`: `['#eff6ff', '#93c5fd', '#1d4ed8']`
  - `viridis`: `['#440154', '#31688e', '#35b779', '#fde725']`
  - `amber-rose`: `['#fef3c7', '#f59e0b', '#ec4899', '#9d174d']`
  - `cyan-blue`: `['#ecfeff', '#38bdf8', '#2563eb', '#1e3a8a']`

---

## Automatic Tool Symbology vs. Explicit Overrides

Tools can emit semantic attributes that automatically receive default styling in `js/ui/selection-style.js` and `js/state.js`:

- **`CompareTool` (`comparisonRole`):**
  - `intersection` (`A ∩ B`): Cyan (`#38bdf8`), solid stroke
  - `only-in-a` (`A - B`): Amber (`#f59e0b`), dashed stroke (`5 4`)
  - `only-in-b` (`B - A`): Magenta (`#ec4899`), dotted stroke (`2 4`)
- **`GroupTool` (`groupId`):**
  - Renders points as colored `L.circleMarker`s and polygons/lines colored deterministically by `groupId`, with ungrouped (`groupId: null`) features styled in muted slate (`#94a3b8`).

Applying an explicit `swb.style.v1` spec via `state.setLayerSymbology()` overrides automatic tool symbology. Calling `state.resetLayerSymbology()` (or clicking **Reset to automatic** in the Style dialog) restores the original map visuals (including comparison dash patterns, marker icons, and automatic TOC legends).

---

## Leaflet & Editability Guarantees

- **Existing Markers Preserved:** Standard `L.Marker` instances are styled in place via `L.divIcon` SVG circles rather than replaced, so dragging, popups, stable IDs, and click/selection listeners remain intact.
- **Selection-Safe:** Selecting and clearing features (`Clear selection`) restores the layer's current base style—even if the style was changed while features were selected.
- **Draw-Edit Guard (`js/ui/draw-style-guard.js`):** During Leaflet Draw geometry edit sessions (`draw:editstart` … `draw:editstop`), the Style editor closes and the TOC Style action disables until editing finishes, then symbology is automatically re-applied to the edited geometries.

---

## GeoJSON Export & Import Round-Trip (`ExportTool` & `AddDataTool`)

When exporting GeoJSON via `ExportTool`:

- **Single layer or feature selection:** The layer's `symbology` object is written once as a top-level `symbology` property on the exported GeoJSON.
- **`"All layers"` (`__all__`) export:** Each styled layer's `symbology` object is stored on its corresponding entry in `layers[]`.

When re-importing GeoJSON via `AddDataTool`:

- **Single-layer GeoJSON:** Top-level `symbology` is automatically validated and re-applied via `state.setLayerSymbology()` during `applyResult()` (invalid specs are safely ignored without blocking import).
- **`"All layers"` (`__all__`) bundles:** `AddDataTool` restores each layer in `layers[]` separately along with its saved `name`, `toolHistory`, and `symbology`.

---

## Programmatic Usage

```js
const state = require('./js/state');

// Color a Spatial Join layer by join_match_count on a Viridis ramp
state.setLayerSymbology('joined-layer-id', {
  version: 'swb.style.v1',
  mode: 'graduated',
  field: 'join_match_count',
  ramp: 'viridis',
  paint: {
    fillOpacity: 0.65,
    weight: 2,
    radius: 7,
  },
});

// Inspect the computed domain shared with the legend
const domain = state.getLayerSymbologyDomain('joined-layer-id');
// -> { min: 0, max: 14, fallbackUsed: false }

// Restore automatic/original layer visuals
state.resetLayerSymbology('joined-layer-id');
```
