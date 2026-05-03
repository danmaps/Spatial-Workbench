# Canonical layer model

Spatial Workbench stores editable geometry as Leaflet layers, but tools and UI should reason about them through a canonical layer summary produced by `js/state.js`.

The goal is to keep layer identity, provenance, geometry, and UI hooks explicit instead of scattered across tool code and UI code.

## Canonical shape

`state.getLayerInfo(layerOrId)` returns a normalized object with this structure:

```js
{
  id,                 // stable id persisted to feature.properties.__id
  label,              // legacy shorthand label, derived from geometry + id
  name,               // explicit user-assigned name, if present
  displayName,        // preferred UI label: explicit name or derived default
  properties,         // GeoJSON properties
  geojson,            // current GeoJSON view of the layer
  bounds,             // Leaflet bounds when available

  geometry: {
    type,             // Point | LineString | Polygon | Mixed | ...
    label,            // UI-safe geometry label: Point | Line | Polygon | Mixed
    featureCount,     // 1 for single features, N for FeatureCollections
    bounds,
  },

  source: {
    kind,             // imported | derived | manual | ai | tool | unknown
    label,            // Imported | Derived | Manual | AI | <tool name> | Layer
    parentLayerId,    // when derived from another layer
    input,            // input file name or other recorded input
    provider,         // AI / provider metadata when available
    importedFileName,
    importSummary,
    metadata,         // sanitized current tool metadata for the layer
  },

  provenance: {
    metadata,         // same sanitized current tool metadata
    history,          // ordered tool history / lineage entries
  },

  ui: {
    visible,          // true when currently present on map / drawnItems
    selectable: true,
    removable: true,
    editable: true,
  },

  // legacy compatibility aliases
  geometryType,
  metadata,
  history,
}
```

## Field meanings

### Stable id

Every tracked layer gets a stable id via `ensureStableId()`. The id is stored on both:

- `layer.__id`
- `layer.feature.properties.__id`

Tools should treat this id as the canonical layer reference for parent/child lineage and removal.

### Display name

Use `displayName` for UI. It resolves in this order:

1. user-assigned name from `properties.name` / `properties.layerName` / `properties.displayName`
2. a derived default name based on source and geometry
3. fallback `label` / `id`

This keeps user naming distinct from geometry labels and internal ids.

### Geometry

Use `geometry.type` and `geometry.featureCount` instead of recomputing from raw GeoJSON in multiple places.

- single features report `featureCount = 1`
- grouped/imported `FeatureCollection` layers report the collection size
- mixed child geometry types report `type = "Mixed"`

### Source and provenance

- `source` answers “where did this layer come from?”
- `provenance` answers “how was it produced over time?”

`source.metadata` / `provenance.metadata` are sanitized copies of the latest tool metadata.
`provenance.history` is the ordered, de-duplicated lineage chain recorded by `ensureToolHistory()`.

### UI hooks

The canonical model intentionally keeps UI hooks lightweight.

`ui.visible` reflects whether the layer is currently present in the map/drawnItems runtime. This is enough for TOC rendering, future visibility toggles, and action enablement without inventing a second persistence model prematurely.

## Adoption guidance

- Prefer `state.getLayerInfo()` in UI code.
- Prefer stable ids from `state.listLayers()` / `state.getLayerInfo()` in tool params.
- Treat `metadata`, `geometryType`, and `history` as legacy aliases while older code migrates.

This model is intentionally practical, not final. It makes the current contract explicit while leaving room for future persisted UI state such as opacity, z-order, or hidden-by-default layers.
