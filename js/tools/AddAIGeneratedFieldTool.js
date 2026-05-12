const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { getLayer, listLayers } = require('../state');
const { generateFieldValues } = require('../ai/fieldGeneration');
const { normalizeHeadlessState, selectFeatureIds, updateFeatures } = require('../runtime/headlessState');

function splitFieldList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function coerceOutputValue(value, outputType) {
  if (value === null || value === undefined) return null;
  if (outputType === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (outputType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }
  return String(value);
}

class AddAIGeneratedFieldTool extends Tool {
  constructor() {
    super('Add AI-Generated Field', [
      new Parameter('Input Layer', 'The input layer to enrich', 'dropdown', ''),
      new Parameter('Source Fields', 'Comma-separated source fields to send to AI', 'text', ''),
      new Parameter('Instruction', 'The instruction used to generate the new field', 'text', ''),
      new Parameter('Output Field Name', 'The field to write', 'text', ''),
      new Parameter('Output Type', 'The output field type', 'dropdown', 'text', ['text', 'number', 'boolean']),
      new Parameter('Overwrite Existing Field', 'Overwrite existing values in the output field', 'boolean', false),
    ]);

    this.description = 'Generate a new attribute field from existing feature attributes using AI';
    this.headlessSupported = true;
  }

  async run(params, context = {}) {
    const instruction = String(params['Instruction'] || '').trim();
    const outputFieldName = String(params['Output Field Name'] || '').trim();
    const outputType = params['Output Type'] || 'text';
    const sourceFields = splitFieldList(params['Source Fields']);
    const overwrite = !!params['Overwrite Existing Field'];

    if (!instruction) {
      this.setStatus(2, 'Instruction is required.');
      return;
    }

    if (!outputFieldName) {
      this.setStatus(2, 'Output Field Name is required.');
      return;
    }

    if (context.headless) {
      return this.runHeadless(params, context, { instruction, outputFieldName, outputType, sourceFields, overwrite });
    }

    return this.runInBrowser(params, { instruction, outputFieldName, outputType, sourceFields, overwrite });
  }

  async runHeadless(params, context, options) {
    const state = normalizeHeadlessState(context.state);
    const targetFeatureIds = selectFeatureIds(state);
    if (!targetFeatureIds.length) {
      this.setStatus(2, 'No target features available.');
      return;
    }

    const idSet = new Set(targetFeatureIds);
    const targetFeatures = state.featureCollection.features.filter((feature) => idSet.has(feature.properties.__id));
    const eligibleFeatures = options.overwrite
      ? targetFeatures
      : targetFeatures.filter((feature) => feature.properties[options.outputFieldName] === undefined);

    if (!eligibleFeatures.length) {
      this.setStatus(2, 'No eligible target features found.');
      return;
    }

    const generated = await generateFieldValues({
      features: eligibleFeatures,
      sourceFields: options.sourceFields,
      instruction: options.instruction,
      outputFieldName: options.outputFieldName,
      outputType: options.outputType,
    });

    const generatedById = new Map(generated.map((item) => [item.id, item.value]));
    const { state: nextState, updatedCount } = updateFeatures(state, eligibleFeatures.map((feature) => feature.properties.__id), (feature) => {
      const nextValue = coerceOutputValue(generatedById.get(feature.properties.__id), options.outputType);
      feature.properties[options.outputFieldName] = nextValue;
      feature.toolMetadata = {
        name: this.name,
        params,
        timestamp: new Date().toISOString(),
      };
    });

    this.setStatus(0, `Updated ${updatedCount} feature(s).`);
    return {
      ok: true,
      updatedCount,
      updatedFeatureIds: eligibleFeatures.map((feature) => feature.properties.__id),
      state: nextState,
    };
  }

  async runInBrowser(params, options) {
    const inputLayerId = params['Input Layer'];
    const layer = inputLayerId ? getLayer(inputLayerId) : null;
    if (!layer || typeof layer.toGeoJSON !== 'function') {
      this.setStatus(2, 'No layer selected.');
      return;
    }

    const feature = layer.toGeoJSON();
    if (!feature.properties) feature.properties = {};
    if (!feature.properties.__id) {
      feature.properties.__id = layer.__id || `feature-${Date.now()}`;
    }

    if (!options.overwrite && feature.properties[options.outputFieldName] !== undefined) {
      this.setStatus(2, 'Output field already exists on the selected layer.');
      return;
    }

    const generated = await generateFieldValues({
      features: [feature],
      sourceFields: options.sourceFields,
      instruction: options.instruction,
      outputFieldName: options.outputFieldName,
      outputType: options.outputType,
    });

    const nextValue = coerceOutputValue(generated[0] && generated[0].value, options.outputType);
    layer.feature = layer.feature || feature;
    layer.feature.properties = layer.feature.properties || {};
    layer.feature.properties[options.outputFieldName] = nextValue;
    layer.feature.toolMetadata = {
      name: this.name,
      params,
      timestamp: new Date().toISOString(),
    };

    if (typeof layer.bindPopup === 'function') {
      let popupContent = "<table class='popupTable'>";
      for (const [key, value] of Object.entries(layer.feature.properties)) {
        popupContent += `<tr><td><b>${key}</b></td><td>${value}</td></tr>`;
      }
      popupContent += '</table>';
      layer.bindPopup(popupContent);
    }

    this.setStatus(0, 'Updated 1 feature.');
    return {
      ok: true,
      updatedCount: 1,
      updatedFeatureIds: [feature.properties.__id],
    };
  }

  renderUI() {
    super.renderUI();

    const inputLayer = document.getElementById('param-Input Layer');
    if (inputLayer) {
      inputLayer.innerHTML = '';
      for (const layer of listLayers()) {
        const option = document.createElement('option');
        option.value = layer.id;
        option.text = layer.label;
        inputLayer.appendChild(option);
      }
    }

    const outputType = document.getElementById('param-Output Type');
    if (outputType) {
      outputType.innerHTML = '';
      for (const choice of ['text', 'number', 'boolean']) {
        const option = document.createElement('option');
        option.value = choice;
        option.text = choice;
        if (choice === 'text') option.selected = true;
        outputType.appendChild(option);
      }
    }
  }
}

module.exports = {
  AddAIGeneratedFieldTool,
};
