const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { getLayer, listLayers, getActiveLayerId } = require('../state');
const { parseNumericText, convertTextsToNumbersWithAI } = require('../ai/numericConversion');
const { normalizeHeadlessState, selectFeatureIds, updateFeatures } = require('../runtime/headlessState');

class ConvertTextToNumericTool extends Tool {
  constructor() {
    super('Convert Text to Numeric', [
      new Parameter('Input Layer', 'The input layer to convert', 'dropdown', ''),
      new Parameter('Input Field Name', 'The text field to parse', 'text', ''),
      new Parameter('Output Field Name', 'The numeric field to write', 'text', ''),
      new Parameter('Overwrite Existing Field', 'Overwrite existing values in the output field', 'boolean', false),
      new Parameter('Use AI Fallback', 'Use AI when rules-based parsing fails', 'boolean', true),
    ]);

    this.description = 'Convert text-like numeric attributes into numeric values';
    this.headlessSupported = true;
  }

  async validate(params, context = {}) {
    const inputFieldName = String(params['Input Field Name'] || '').trim();
    const outputFieldName = String(params['Output Field Name'] || '').trim();
    const overwrite = !!params['Overwrite Existing Field'];
    const errors = [];

    if (!inputFieldName) errors.push('Input Field Name is required.');
    if (!outputFieldName) errors.push('Output Field Name is required.');

    if (context.headless && outputFieldName) {
      const state = normalizeHeadlessState(context.state);
      const targetFeatureIds = selectFeatureIds(state);
      if (!targetFeatureIds.length) {
        errors.push('No target features available.');
      } else {
        const idSet = new Set(targetFeatureIds);
        const targetFeatures = state.featureCollection.features.filter((feature) => idSet.has(feature.properties.__id));
        const eligibleFeatures = overwrite
          ? targetFeatures
          : targetFeatures.filter((feature) => feature.properties[outputFieldName] === undefined);
        if (!eligibleFeatures.length) errors.push('No eligible target features found.');
      }
    } else if (!context.headless && outputFieldName) {
      const inputLayerId = params['Input Layer'];
      const layer = inputLayerId ? getLayer(inputLayerId) : null;
      if (!layer || typeof layer.toGeoJSON !== 'function') {
        errors.push('No layer selected.');
      } else if (!overwrite) {
        const feature = layer.toGeoJSON();
        feature.properties = feature.properties || {};
        if (feature.properties[outputFieldName] !== undefined) {
          errors.push('Output field already exists on the selected layer.');
        }
      }
    }

    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const inputFieldName = String(params['Input Field Name'] || '').trim();
    const outputFieldName = String(params['Output Field Name'] || '').trim();
    const overwrite = !!params['Overwrite Existing Field'];
    const useAiFallback = !!params['Use AI Fallback'];

    if (!inputFieldName) {
      this.setStatus(2, 'Input Field Name is required.');
      return;
    }

    if (!outputFieldName) {
      this.setStatus(2, 'Output Field Name is required.');
      return;
    }

    if (context.headless) {
      return this.runHeadless(params, context, { inputFieldName, outputFieldName, overwrite, useAiFallback });
    }

    return this.runInBrowser(params, { inputFieldName, outputFieldName, overwrite, useAiFallback });
  }

  async convertFeatureValues(features, options) {
    const conversions = [];
    const aiCandidates = [];

    for (const feature of features) {
      const rawValue = feature.properties ? feature.properties[options.inputFieldName] : undefined;
      const parsed = parseNumericText(rawValue);
      if (parsed.ok) {
        conversions.push({
          id: feature.properties.__id,
          value: parsed.value,
          mode: parsed.mode,
        });
      } else {
        aiCandidates.push({
          id: feature.properties.__id,
          value: rawValue,
        });
      }
    }

    if (options.useAiFallback && aiCandidates.length) {
      const aiResults = await convertTextsToNumbersWithAI(aiCandidates);
      for (const result of aiResults) {
        conversions.push({
          id: result.id,
          value: result.value,
          mode: result.value === null ? 'failed' : 'ai',
        });
      }
    } else {
      for (const candidate of aiCandidates) {
        conversions.push({
          id: candidate.id,
          value: null,
          mode: 'failed',
        });
      }
    }

    return conversions;
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

    const conversions = await this.convertFeatureValues(eligibleFeatures, options);
    const conversionMap = new Map(conversions.map((item) => [item.id, item]));

    const { state: nextState, updatedCount } = updateFeatures(state, eligibleFeatures.map((feature) => feature.properties.__id), (feature) => {
      const next = conversionMap.get(feature.properties.__id);
      feature.properties[options.outputFieldName] = next ? next.value : null;
      feature.toolMetadata = {
        name: this.name,
        params,
        timestamp: new Date().toISOString(),
      };
    });

    const convertedCount = conversions.filter((item) => item.value !== null).length;
    const failedIds = conversions.filter((item) => item.value === null).map((item) => item.id);
    this.setStatus(0, `Converted ${convertedCount} feature(s); ${failedIds.length} failed.`);

    return {
      ok: true,
      updatedCount,
      convertedCount,
      failedFeatureIds: failedIds,
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

    const conversions = await this.convertFeatureValues([feature], options);
    const value = conversions[0] ? conversions[0].value : null;

    layer.feature = layer.feature || feature;
    layer.feature.properties = layer.feature.properties || {};
    layer.feature.properties[options.outputFieldName] = value;
    layer.feature.toolMetadata = {
      name: this.name,
      params,
      timestamp: new Date().toISOString(),
    };

    this.setStatus(0, value === null ? 'Value could not be converted.' : 'Converted 1 feature.');
    return {
      ok: true,
      updatedCount: 1,
      convertedCount: value === null ? 0 : 1,
      failedFeatureIds: value === null ? [feature.properties.__id] : [],
    };
  }

  renderUI() {
    super.renderUI();

    const inputLayer = document.getElementById('param-Input Layer');
    if (inputLayer) {
      inputLayer.innerHTML = '';
      const activeLayerId = typeof getActiveLayerId === 'function' ? getActiveLayerId() : null;
      for (const layer of listLayers()) {
        const option = document.createElement('option');
        option.value = layer.id;
        option.text = layer.label;
        if (layer.id === activeLayerId || (!activeLayerId && inputLayer.childElementCount === 0)) option.selected = true;
        inputLayer.appendChild(option);
      }
    }
  }
}

module.exports = {
  ConvertTextToNumericTool,
};
