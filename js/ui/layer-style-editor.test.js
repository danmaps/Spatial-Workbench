const { getStyleFields, createStyleLegend, openLayerStyleEditor } = require('./layer-style-editor');

const geojson = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { __id: '1', name: '<img src=x>', amount: 0, numericText: '12', bad: Infinity }, geometry: null },
    { type: 'Feature', properties: { __id: '2', name: 'B', amount: null, flag: false, object: {} }, geometry: null },
  ],
};

function setupEditor(spec = null) {
  const layer = {};
  const state = {
    getLayerInfo: jest.fn(() => ({ geojson })),
    getLayerSymbology: jest.fn(() => spec),
    setLayerSymbology: jest.fn(),
    resetLayerSymbology: jest.fn(),
  };
  const onChange = jest.fn();
  const dialog = openLayerStyleEditor({ layer, layerName: '<unsafe>', state, onChange });
  return { dialog, layer, state, onChange };
}

afterEach(() => { document.body.replaceChildren(); });

test('offers only fields with finite numeric values for graduated styles', () => {
  const fields = getStyleFields(geojson);
  expect(fields.graduated).toEqual(['amount']);
  expect(fields.categorical).toEqual(['amount', 'flag', 'name', 'numericText']);
});

test('applies graduated style and requires an eligible field', () => {
  const { dialog, layer, state, onChange } = setupEditor();
  const mode = dialog.querySelector('[name=mode]');
  mode.value = 'graduated';
  mode.dispatchEvent(new Event('change'));
  const field = dialog.querySelector('[name=field]');
  expect(Array.from(field.options, (option) => option.value)).toEqual(['', 'amount']);
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(state.setLayerSymbology).not.toHaveBeenCalled();
  expect(dialog.querySelector('[role=alert]').textContent).toMatch(/select a field/i);
  field.value = 'amount';
  dialog.querySelector('[name=opacity]').value = '0.4';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(state.setLayerSymbology).toHaveBeenCalledWith(layer, expect.objectContaining({
    version: 'swb.style.v1', mode: 'graduated', field: 'amount', ramp: 'blue',
    paint: expect.objectContaining({ opacity: 0.4, fillOpacity: 0.5 }),
  }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(document.getElementById('layerStyleEditor')).toBeNull();
});

test('edits categorical styles, displays text safely, and resets automatic styling', () => {
  const { dialog, layer, state, onChange } = setupEditor({ mode: 'categorical', field: 'name', palette: 'vivid', paint: { fillOpacity: 0.7 } });
  expect(dialog.querySelector('h2').textContent).toBe('Style: <unsafe>');
  expect(dialog.querySelector('h2').children).toHaveLength(0);
  expect(dialog.querySelector('[name=field]').value).toBe('name');
  expect(dialog.querySelector('[name=palette]').value).toBe('vivid');
  Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Reset to automatic').click();
  expect(state.resetLayerSymbology).toHaveBeenCalledWith(layer);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('preserves independent fill and stroke paint and other v1 properties', () => {
  const { dialog, layer, state } = setupEditor({
    version: 'swb.style.v1', mode: 'single', fallbackColor: '#112233',
    paint: { fillColor: '#aabbcc', color: '#334455', fillOpacity: 0.3, opacity: 0.8, weight: 9, radius: 11 },
  });
  dialog.querySelector('[name=fillColor]').value = '#123456';
  dialog.querySelector('[name=color]').value = '#654321';
  dialog.querySelector('[name=fillOpacity]').value = '0.6';
  dialog.querySelector('[name=opacity]').value = '0.2';
  dialog.querySelector('[name=weight]').value = '2.5';
  dialog.querySelector('[name=radius]').value = '12';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(state.setLayerSymbology).toHaveBeenCalledWith(layer, expect.objectContaining({
    fallbackColor: '#112233',
    paint: { fillColor: '#123456', color: '#654321', fillOpacity: 0.6, opacity: 0.2, weight: 2.5, radius: 12 },
  }));
});

test('applies a categorical palette and rejects invalid dimensions', () => {
  const { dialog, layer, state } = setupEditor();
  const mode = dialog.querySelector('[name=mode]');
  mode.value = 'categorical';
  mode.dispatchEvent(new Event('change'));
  dialog.querySelector('[name=field]').value = 'name';
  dialog.querySelector('[name=palette]').value = 'vivid';
  const radius = dialog.querySelector('[name=radius]');
  radius.value = '101';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(state.setLayerSymbology).not.toHaveBeenCalled();
  expect(dialog.querySelector('[role=alert]').textContent).toMatch(/radius/i);
  radius.value = '7';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(state.setLayerSymbology).toHaveBeenCalledWith(layer, expect.objectContaining({
    mode: 'categorical', field: 'name', palette: 'vivid',
  }));
});

test('legend shows exact domain and fallback without interpreting labels as HTML', () => {
  const spec = { mode: 'categorical', paint: { fillOpacity: 0.5 } };
  const legend = createStyleLegend(spec, {
    categories: [{ label: '<img src=x>', color: '#123456' }],
    fallbackUsed: true,
  });
  expect(legend.querySelector('img')).toBeNull();
  expect(legend.textContent).toContain('<img src=x>');
  expect(legend.textContent).toContain('No data / other');
  expect(legend.querySelector('.layer-style-swatch').style.opacity).toBe('0.5');
  const graduated = createStyleLegend({ mode: 'graduated', ramp: 'blue', paint: { opacity: 0.4 } }, { min: 0, max: 10 }, 'LineString');
  expect(graduated.textContent).toContain('0 – 10');
  expect(graduated.querySelector('.layer-style-swatch').style.opacity).toBe('0.4');
  const equal = createStyleLegend({ mode: 'graduated', ramp: 'blue' }, { min: 3, max: 3 });
  expect(equal.querySelector('.layer-style-swatch').style.backgroundColor).toBe('rgb(147, 197, 253)');
  const line = createStyleLegend({ mode: 'single', paint: { fillColor: '#112233', color: '#445566', opacity: 0.3 } }, {}, 'LineString');
  expect(line.querySelector('.layer-style-swatch').style.backgroundColor).toBe('rgb(68, 85, 102)');
  expect(line.querySelector('.layer-style-swatch').style.opacity).toBe('0.3');
  expect(createStyleLegend(null)).toBeNull();
});

test('shows state validation errors without closing or refreshing', () => {
  const { dialog, state, onChange } = setupEditor();
  state.setLayerSymbology.mockImplementation(() => { throw new TypeError('Invalid style'); });
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(dialog.querySelector('[role=alert]').textContent).toBe('Invalid style');
  expect(dialog.isConnected).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
