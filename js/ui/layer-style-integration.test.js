jest.mock('../app', () => ({
  map: { on: jest.fn(), hasLayer: jest.fn(() => false) },
  drawnItems: { hasLayer: jest.fn(() => false) },
  tocLayers: [],
}));

const state = require('../state');
const { createStyleLegend } = require('./layer-style-editor');

test('refreshing the TOC domain after an attribute edit updates both map paint and legend', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { value: 'before' },
  };
  const layer = {
    feature,
    options: {},
    toGeoJSON: () => feature,
    setStyle: jest.fn(),
  };
  state.registerLayer(layer, 'style-integration');
  state.setLayerSymbology(layer, { mode: 'categorical', field: 'value' });
  feature.properties.value = 'after';
  const spec = state.getLayerSymbology(layer);
  const domain = state.getLayerSymbologyDomain(layer);
  const legend = createStyleLegend(spec, domain, 'LineString');
  expect(domain.categories.map((category) => category.label)).toEqual(['after']);
  expect(legend.textContent).toContain('after');
  expect(legend.textContent).not.toContain('before');
  expect(layer.setStyle).toHaveBeenCalledTimes(2);
  expect(layer.setStyle).toHaveBeenLastCalledWith(expect.objectContaining({ color: domain.categories[0].color }));
  expect(legend.querySelector('.layer-style-swatch').style.backgroundColor).toBe('rgb(56, 189, 248)');
});
