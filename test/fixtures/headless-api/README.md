# Headless API fixtures

These fixtures back `server.headless.test.js`, which starts the Express app on an ephemeral port and calls `/api/run` with Node's `http` module. The tests do not load the browser UI or `public/dist/bundle.js`.

## Files

- `source-points.geojson` is the shared sample input layer. It contains three nearby warehouse points and one distant outpost with text-like numeric attributes.
- `boundary-polygon.geojson` is a simple polygon used by polygon-scoped API examples.
- `expected-buffer-summary.json` is a stable summary of `BufferTool` output. It avoids storing Turf's bulky generated coordinates while still checking feature count, polygon output, source properties, and provenance.
- `expected-export-source-points.geojson` is the exact GeoJSON expected from `ExportTool`.
- `expected-convert-text-to-numeric.geojson` is the known-good FeatureCollection after `ConvertTextToNumericTool` parses `population_text` into `population`.
- `expected-grouped-points.geojson` is the known-good grouped result from `GroupTool` using a 5 kilometer distance.

## Turf-Derived Fixtures

The `turf-derived/` folder contains a deliberately small subset of fixtures copied from the Turf.js repository to exercise edge cases that are easy to miss with hand-written toy data.

Source repository:

- `https://github.com/Turfjs/turf`

Copied fixtures:

- `turf-derived/buffer-polygon-with-holes.geojson`
  - Source: `packages/turf-buffer/test/in/polygon-with-holes.geojson`
  - Used to prove `BufferTool` can run against a polygon with an interior ring through `/api/run`.
- `turf-derived/dbscan-points-with-properties.geojson`
  - Source: `packages/turf-clusters-dbscan/test/in/points-with-properties.geojson`
  - Used to prove `GroupTool` preserves source properties while assigning grouped DBSCAN properties through `/api/run`.
- `turf-derived/polygon-with-hole.geojson`
  - Source: `packages/turf-boolean-point-in-polygon/test/in/poly-with-hole.geojson`
  - Used to prove polygon-scoped `RandomPointsTool` returns points inside the outer polygon and outside the hole.

Expected summaries:

- `turf-derived/expected-buffer-polygon-with-holes-summary.json` captures stable Workbench output fields for the polygon-with-holes buffer case without storing Turf's generated buffer coordinates.
- `turf-derived/expected-dbscan-group-summary.json` captures stable Workbench grouping fields for the DBSCAN fixture.

License note:

- Turf.js is MIT licensed. The copied license text is included at `turf-derived/LICENSE-TURF-MIT.txt`.
- Keep Turf-derived fixtures in the `turf-derived/` folder so their origin remains clear.

## Dynamic Fields

Some headless tool responses include runtime-generated fields such as result layer ids and tool metadata timestamps. Tests normalize those dynamic values before comparing output GeoJSON to these known-good fixtures.

## Running

```bash
npm test -- --runInBand server.headless.test.js
```
