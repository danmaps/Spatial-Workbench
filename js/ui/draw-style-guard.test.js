const L = require('leaflet');
jest.mock('../app', () => ({
  map: { on: jest.fn(), hasLayer: jest.fn(() => false) },
  drawnItems: { hasLayer: () => false },
  tocLayers: [],
}));
const state = require('../state');
const { createDrawStyleGuard } = require('./draw-style-guard');

test.each(['save', 'cancel'])('defers style changes while editing and reapplies explicit paint after %s', (action) => {
  global.L = L;
  const map = new L.Evented();
  const line = L.polyline([[0, 0], [1, 1]], { color: '#112233', fillColor: '#223344' });
  line.feature = { type: 'Feature', properties: { value: 1 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  state.registerLayer(line, `edit-${Math.random()}`);
  const spec = state.setLayerSymbology(line, { mode: 'graduated', field: 'value', paint: { opacity: 0.6 } });
  const closeEditor = jest.fn();
  const refresh = jest.fn();
  const guard = createDrawStyleGuard({ map, state, getLayers: () => [line], closeEditor, refresh });
  map.fire('draw:editstart');
  expect(guard.isEditing()).toBe(true);
  expect(closeEditor).toHaveBeenCalledTimes(1);
  line.setStyle({ color: '#ffee00' });
  line.feature.properties.value = 2;
  expect(guard.getDomain(line, spec, line.toGeoJSON())).toEqual({ min: 2, max: 2, fallbackUsed: false });
  expect(line.options.color).toBe('#ffee00');
  if (action === 'cancel') line.feature.properties.value = 1;
  // Leaflet Draw restores its saved path options before emitting editstop.
  line.setStyle({ color: '#aabbcc' });
  map.fire('draw:editstop');
  expect(guard.isEditing()).toBe(false);
  expect(line.options.color).toBe('#93c5fd');
  expect(line.options.opacity).toBe(0.6);
  expect(state.getLayerSymbologyDomain(line).min).toBe(action === 'save' ? 2 : 1);
  expect(refresh).toHaveBeenCalledTimes(2);
  state.resetLayerSymbology(line);
  expect(line.options.color).toBe('#112233');
  expect(line.options.fillColor).toBe('#223344');
});

test('editor is closed when geometry editing begins, including an unsaved style', () => {
  const { openLayerStyleEditor, closeLayerStyleEditor } = require('./layer-style-editor');
  const map = new L.Evented();
  const layer = {};
  const fakeState = { getLayerSymbology: () => null, getLayerInfo: () => ({}) };
  openLayerStyleEditor({ layer, layerName: 'Layer', state: fakeState, onChange: jest.fn() });
  createDrawStyleGuard({ map, state: fakeState, getLayers: () => [], closeEditor: closeLayerStyleEditor, refresh: jest.fn() });
  map.fire('draw:editstart');
  expect(document.getElementById('layerStyleEditor')).toBeNull();
});
