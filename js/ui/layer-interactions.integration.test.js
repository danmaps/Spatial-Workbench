jest.mock('../runtime/toolRegistry', () => ({ instantiateTools: () => [] }));

test('a styled drawn point can be selected and cleared through the TOC', () => {
  const L = require('leaflet');
  const map = new L.Evented();
  map.setView = () => map;
  map.addLayer = () => map;
  map.addControl = () => map;
  map.hasLayer = () => false;
  map.closePopup = jest.fn();
  L.map = () => map;
  L.Control.Draw = function () {};
  L.Draw = { Event: { CREATED: 'draw:created' } };
  L.tileLayer = () => ({ addTo: () => ({}) });
  global.L = L;
  global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
  global.Prism = { highlight: (value) => value, languages: { json: {} } };
  document.body.innerHTML = `
    <button id="backButton"></button><div id="toolSelection"></div>
    <div id="DataContent"></div><div id="tocContent"></div>
    <button data-map-interaction-mode="select"></button>`;
  const app = require('../app');
  const state = require('../state');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  document.querySelector('[data-map-interaction-mode=select]').click();

  const marker = L.marker([1, 2]);
  marker.feature = { type: 'Feature', properties: { name: 'Point' }, geometry: { type: 'Point', coordinates: [2, 1] } };
  map.fire('draw:created', { layer: marker, layerType: 'marker' });
  const id = state.ensureStableId(marker);
  state.setLayerSymbology(marker, { mode: 'single', paint: { fillColor: '#112233' } });
  marker.fire('click');
  expect(state.getSelectedFeatureIds(id)).toHaveLength(1);
  const clear = document.querySelector('.layer-clear-selection');
  expect(clear).not.toBeNull();
  document.querySelector('.layer-menu-trigger').click();
  document.querySelector('[aria-label="Style layer"]').click();
  expect(document.getElementById('layerStyleEditor')).not.toBeNull();
  map.fire('draw:editstart');
  expect(document.getElementById('layerStyleEditor')).toBeNull();
  document.querySelector('.layer-menu-trigger').click();
  expect(document.querySelector('[aria-label="Style layer"]').disabled).toBe(true);
  map.fire('draw:editstop');
  document.querySelector('.layer-menu-trigger').click();
  expect(document.querySelector('[aria-label="Style layer"]').disabled).toBe(false);
  const repaintedIcon = marker.options.icon;
  expect(repaintedIcon.options.html).toContain('#112233');
  document.querySelector('.layer-clear-selection').click();
  expect(state.getSelectedFeatureIds(id)).toEqual([]);
  expect(marker.options.icon).toBe(repaintedIcon);
  expect(state.getLayerSymbology(marker).paint.fillColor).toBe('#112233');
  expect(app.tocLayers).toContain(marker);
});
