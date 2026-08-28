const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { getLayer, listLayers, getActiveLayerId, getSelectedFeatureIds, setSelectedFeatureIds } = require('../state');

const OPERATORS = ['equals', 'not equals', 'contains', 'starts with', 'ends with', 'greater than', 'less than', 'is empty', 'is not empty'];
const MODES = ['replace', 'add', 'remove'];

function featuresFromGeoJSON(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection') return Array.isArray(geojson.features) ? geojson.features : [];
  if (geojson.type === 'Feature') return [geojson];
  return [];
}

function featureId(feature, layerId, index) {
  if (!feature || typeof feature !== 'object') return `${layerId || 'feature'}-${index + 1}`;
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
  const id = feature.properties.__id || feature.id || `${layerId || 'feature'}-${index + 1}`;
  feature.properties.__id = id;
  return id;
}

function comparable(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesAttribute(value, operator, expected) {
  const actualText = comparable(value);
  const expectedText = comparable(expected);
  if (operator === 'is empty') return value === null || value === undefined || actualText === '';
  if (operator === 'is not empty') return !(value === null || value === undefined || actualText === '');
  if (operator === 'contains') return actualText.includes(expectedText);
  if (operator === 'starts with') return actualText.startsWith(expectedText);
  if (operator === 'ends with') return actualText.endsWith(expectedText);

  if (operator === 'greater than' || operator === 'less than') {
    const actualNumber = numeric(value);
    const expectedNumber = numeric(expected);
    if (actualNumber === null || expectedNumber === null) return false;
    return operator === 'greater than' ? actualNumber > expectedNumber : actualNumber < expectedNumber;
  }

  return operator === 'equals' ? actualText === expectedText : actualText !== expectedText;
}

function selectIds(features, params, layerId) {
  const field = String(params.Field || '').trim();
  const operator = params.Operator || 'equals';
  const expected = params.Value;
  return features.reduce((ids, feature, index) => {
    const id = featureId(feature, layerId, index);
    if (matchesAttribute(feature?.properties?.[field], operator, expected)) ids.push(id);
    return ids;
  }, []);
}

function applyMode(existingIds, matchedIds, mode) {
  const existing = new Set(existingIds || []);
  if (mode === 'add') matchedIds.forEach((id) => existing.add(id));
  else if (mode === 'remove') matchedIds.forEach((id) => existing.delete(id));
  else return Array.from(new Set(matchedIds));
  return Array.from(existing);
}

class SelectByAttributeTool extends Tool {
  constructor() {
    super('Select by Attribute', [
      new Parameter('Layer', 'Layer to query', 'dropdown', ''),
      new Parameter('Field', 'Attribute field to query', 'text', ''),
      new Parameter('Operator', 'Attribute comparison', 'dropdown', 'equals', OPERATORS),
      new Parameter('Value', 'Value to compare', 'text', ''),
      new Parameter('Selection Mode', 'How to apply matching features', 'dropdown', 'replace', MODES),
    ]);
    this.description = 'Selects features using an attribute condition';
    this.headlessSupported = true;
    this.execution = { stateMode: 'layers', inputs: [{ parameter: 'Layer', kind: 'layer', geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: false }], outputs: [{ kind: 'selection', operation: 'update' }], mutatesState: true, producesArtifacts: false };
  }

  async validate(params) {
    const errors = [];
    if (!String(params.Field || '').trim()) errors.push('Field is required.');
    if (!OPERATORS.includes(params.Operator || 'equals')) errors.push('Operator is invalid.');
    if (!MODES.includes(params['Selection Mode'] || 'replace')) errors.push('Selection Mode is invalid.');
    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const layerId = params.Layer;
    const resolveLayer = context.getLayer || getLayer;
    const layer = layerId ? resolveLayer(layerId) : null;
    const features = featuresFromGeoJSON(layer?.toGeoJSON?.());
    if (!layer || !features.length) {
      this.setStatus(2, 'No layer or features available.');
      return;
    }

    const matchedIds = selectIds(features, params, layerId);
    const mode = params['Selection Mode'] || 'replace';
    const currentIds = context.headless
      ? (context.state?.selection?.selectedFeaturesByLayerId?.[layerId] || [])
      : getSelectedFeatureIds(layerId);
    const selectedIds = applyMode(currentIds, matchedIds, mode);

    if (context.headless) {
      if (typeof context.setSelectedFeatureIds === 'function') context.setSelectedFeatureIds(layerId, selectedIds);
      else {
        const state = JSON.parse(JSON.stringify(context.state || {}));
        state.selection = state.selection || {};
        state.selection.selectedFeaturesByLayerId = state.selection.selectedFeaturesByLayerId || {};
        if (selectedIds.length) state.selection.selectedFeaturesByLayerId[layerId] = selectedIds;
        else delete state.selection.selectedFeaturesByLayerId[layerId];
        state.selection.activeLayerId = state.selection.activeLayerId || layerId;
        state.selection.selectedLayerIds = Array.from(new Set([...(state.selection.selectedLayerIds || []), layerId]));
        this.setStatus(0, `Selected ${matchedIds.length} feature(s) by attribute.`);
        return { selectedCount: selectedIds.length, matchedCount: matchedIds.length, state };
      }
      this.setStatus(0, `Selected ${matchedIds.length} feature(s) by attribute.`);
      return { selectedCount: selectedIds.length, matchedCount: matchedIds.length };
    }

    setSelectedFeatureIds(layerId, selectedIds);
    this.setStatus(0, `Selected ${matchedIds.length} feature(s) by attribute.`);
    return { selectedCount: selectedIds.length, matchedCount: matchedIds.length };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    const layerInput = document.getElementById('param-Layer');
    if (layerInput) {
      layerInput.innerHTML = '';
      const activeLayerId = getActiveLayerId();
      listLayers().forEach((layer, index) => {
        const option = document.createElement('option');
        option.value = layer.id;
        option.text = layer.label;
        option.selected = layer.id === (paramValues.Layer || activeLayerId || (index === 0 ? layer.id : null));
        layerInput.appendChild(option);
      });
    }
    const operatorInput = document.getElementById('param-Operator');
    const modeInput = document.getElementById('param-Selection Mode');
    [[operatorInput, OPERATORS], [modeInput, MODES]].forEach(([input, options]) => {
      if (!input) return;
      input.innerHTML = '';
      options.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.text = value.charAt(0).toUpperCase() + value.slice(1);
        option.selected = value === (paramValues[input.id.replace('param-', '')] || options[0]);
        input.appendChild(option);
      });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SelectByAttributeTool, matchesAttribute, applyMode };
else window.SelectByAttributeTool = SelectByAttributeTool;
