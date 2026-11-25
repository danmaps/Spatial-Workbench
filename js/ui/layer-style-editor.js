const { PALETTES, RAMPS, DEFAULTS, FALLBACK_COLOR, rampColor } = require('./layer-symbology');
const { normalizeToFeatures } = require('./attribute-view');

function getStyleFields(geojson) {
  const categorical = new Set();
  const numeric = new Set();
  normalizeToFeatures(geojson).forEach((feature) => {
    Object.entries(feature.properties || {}).forEach(([key, value]) => {
      if (key === '__id' || key === '__datasetId') return;
      if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        categorical.add(key);
      }
      if (typeof value === 'number' && Number.isFinite(value)) numeric.add(key);
    });
  });
  const sorted = (values) => Array.from(values).sort((a, b) => a.localeCompare(b));
  return { categorical: sorted(categorical), graduated: sorted(numeric) };
}

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function createStyleLegend(spec, domain = {}, geometryType = '') {
  if (!spec) return null;
  const paint = { ...DEFAULTS.paint, ...spec.paint };
  const isLine = /LineString/i.test(geometryType);
  const legend = document.createElement('div');
  legend.className = 'layer-style-legend';
  legend.setAttribute('aria-label', 'Layer style legend');
  const addItem = (label, color) => {
    const item = document.createElement('span');
    item.className = 'layer-style-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'layer-style-swatch';
    if (Array.isArray(color)) swatch.style.background = `linear-gradient(to right, ${color.join(', ')})`;
    else swatch.style.backgroundColor = color;
    swatch.style.opacity = String(isLine ? paint.opacity : paint.fillOpacity);
    const text = document.createElement('span');
    text.textContent = label;
    item.append(swatch, text);
    legend.appendChild(item);
  };
  if (spec.mode === 'categorical') {
    (domain.categories || []).forEach((category) => addItem(category.label, category.color));
  } else if (spec.mode === 'graduated') {
    const ramp = RAMPS[spec.ramp] || RAMPS.blue;
    if (Number.isFinite(domain.min) && Number.isFinite(domain.max)) {
      addItem(`${domain.min} – ${domain.max}`, domain.min === domain.max ? rampColor(ramp, 0.5) : ramp);
    }
  } else {
    addItem('Single symbol', isLine ? paint.color : paint.fillColor);
  }
  if (domain.fallbackUsed) addItem('No data / other', spec.fallbackColor || FALLBACK_COLOR);
  return legend;
}

function closeLayerStyleEditor() {
  const dialog = document.getElementById('layerStyleEditor');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  dialog.remove();
}

function openLayerStyleEditor({ layer, layerName, state, onChange }) {
  closeLayerStyleEditor();
  const dialog = document.createElement('dialog');
  dialog.id = 'layerStyleEditor';
  dialog.className = 'layer-style-dialog';
  dialog.setAttribute('aria-labelledby', 'layerStyleTitle');
  const form = document.createElement('form');
  form.className = 'layer-style-form';
  const title = document.createElement('h2');
  title.id = 'layerStyleTitle';
  title.textContent = `Style: ${layerName}`;
  form.appendChild(title);

  const existingSpec = state.getLayerSymbology(layer) || {};
  const current = { ...DEFAULTS, ...existingSpec, paint: { ...DEFAULTS.paint, ...existingSpec.paint } };
  const fields = getStyleFields(state.getLayerInfo(layer)?.geojson);
  const controls = {};
  const rows = {};
  function addControl(name, labelText, element) {
    const label = document.createElement('label');
    label.className = 'layer-style-control';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    element.name = name;
    label.append(caption, element);
    rows[name] = label;
    controls[name] = element;
    form.appendChild(label);
  }
  const mode = document.createElement('select');
  [['single', 'Single symbol'], ['categorical', 'Categorical'], ['graduated', 'Graduated']].forEach(([value, label]) => addOption(mode, value, label));
  mode.value = current.mode;
  addControl('mode', 'Mode', mode);
  const fillColor = document.createElement('input');
  fillColor.type = 'color';
  fillColor.value = current.paint.fillColor;
  addControl('fillColor', 'Fill color', fillColor);
  const strokeColor = document.createElement('input');
  strokeColor.type = 'color';
  strokeColor.value = current.paint.color;
  addControl('color', 'Stroke color', strokeColor);
  const field = document.createElement('select');
  addControl('field', 'Field', field);
  const palette = document.createElement('select');
  Object.keys(PALETTES).forEach((key) => addOption(palette, key, key));
  palette.value = current.palette;
  addControl('palette', 'Palette', palette);
  const ramp = document.createElement('select');
  Object.keys(RAMPS).forEach((key) => addOption(ramp, key, key));
  ramp.value = current.ramp;
  addControl('ramp', 'Ramp', ramp);
  const fillOpacity = document.createElement('input');
  fillOpacity.type = 'range';
  fillOpacity.min = '0';
  fillOpacity.max = '1';
  fillOpacity.step = '0.05';
  fillOpacity.value = String(current.paint.fillOpacity);
  addControl('fillOpacity', 'Fill opacity', fillOpacity);
  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.min = '0';
  opacity.max = '1';
  opacity.step = '0.05';
  opacity.value = String(current.paint.opacity);
  addControl('opacity', 'Stroke opacity', opacity);
  const weight = document.createElement('input');
  weight.type = 'number';
  weight.min = '0';
  weight.max = '20';
  weight.step = 'any';
  weight.value = String(current.paint.weight);
  addControl('weight', 'Stroke width', weight);
  const radius = document.createElement('input');
  radius.type = 'number';
  radius.min = '0';
  radius.max = '100';
  radius.step = 'any';
  radius.value = String(current.paint.radius);
  addControl('radius', 'Point radius', radius);

  const note = document.createElement('p');
  note.className = 'layer-style-note';
  const error = document.createElement('p');
  error.className = 'layer-style-error';
  error.setAttribute('role', 'alert');
  form.append(note, error);
  function updateMode() {
    const selectedField = field.value || current.field;
    rows.fillColor.hidden = mode.value !== 'single';
    rows.color.hidden = mode.value !== 'single';
    rows.field.hidden = mode.value === 'single';
    rows.palette.hidden = mode.value !== 'categorical';
    rows.ramp.hidden = mode.value !== 'graduated';
    field.replaceChildren();
    addOption(field, '', 'Select a field');
    (fields[mode.value] || []).forEach((name) => addOption(field, name, name));
    if (Array.from(field.options).some((option) => option.value === selectedField)) field.value = selectedField;
    note.textContent = mode.value === 'graduated'
      ? 'Only fields with finite numeric values are available. Other values use the fallback color.'
      : mode.value === 'categorical' ? 'Missing or non-scalar values use the fallback color.' : '';
  }
  mode.addEventListener('change', updateMode);
  updateMode();

  const actions = document.createElement('div');
  actions.className = 'layer-style-actions';
  const close = () => {
    closeLayerStyleEditor();
  };
  const button = (text, type, handler) => {
    const element = document.createElement('button');
    element.type = type;
    element.className = 'btn btn-sm btn-secondary';
    element.textContent = text;
    if (handler) element.addEventListener('click', handler);
    actions.appendChild(element);
    return element;
  };
  button('Reset to automatic', 'button', () => {
    try {
      state.resetLayerSymbology(layer);
      onChange();
      close();
    } catch (err) {
      error.textContent = err.message || 'Could not reset the style.';
    }
  });
  button('Cancel', 'button', close);
  button('Apply', 'submit').className = 'btn btn-sm btn-primary';
  form.appendChild(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode.value !== 'single' && !field.value) {
      error.textContent = 'Select a field for this style.';
      field.focus();
      return;
    }
    if (!weight.value || !radius.value || !Number.isFinite(Number(weight.value)) || Number(weight.value) < 0 || Number(weight.value) > 20
      || !Number.isFinite(Number(radius.value)) || Number(radius.value) < 0 || Number(radius.value) > 100) {
      error.textContent = 'Stroke width must be 0–20 and point radius 0–100.';
      return;
    }
    try {
      state.setLayerSymbology(layer, {
        ...current,
        mode: mode.value, field: field.value, palette: palette.value, ramp: ramp.value,
        paint: {
          ...current.paint, fillColor: fillColor.value, color: strokeColor.value,
          fillOpacity: Number(fillOpacity.value), opacity: Number(opacity.value),
          weight: Number(weight.value), radius: Number(radius.value),
        },
      });
      onChange();
      close();
    } catch (err) {
      error.textContent = err.message || 'Could not apply the style.';
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  mode.focus();
  return dialog;
}

module.exports = { getStyleFields, createStyleLegend, openLayerStyleEditor, closeLayerStyleEditor };
