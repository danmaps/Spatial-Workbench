const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');
const { computeAreaSqm, dissolvePolygons, targetFeatures } = require('./overlay');

function cloneFeature(feature) {
  return feature == null ? null : JSON.parse(JSON.stringify(feature));
}

class DissolveTool extends Tool {
  constructor() {
    super('Dissolve', [
      new Parameter('Input Layer', 'Polygon layer to dissolve', 'dropdown', '', null, null, null, true),
      new Parameter('Dissolve Field', 'Attribute field to group by (leave empty to dissolve all)', 'text', '', null, null, null, false),
    ]);
    this.description = 'Merges polygon features into a single boundary or groups them by a shared attribute field';
    this.headlessSupported = true;
    this.execution = {
      stateMode: 'layers',
      inputs: [
        {
          parameter: 'Input Layer',
          kind: 'layer',
          geometryTypes: ['Polygon', 'MultiPolygon'],
          cardinality: 'one',
          selectionAware: true,
        },
      ],
      outputs: [{ kind: 'layer', operation: 'add', geometryType: 'Polygon' }],
      mutatesState: true,
      producesArtifacts: false,
    };
  }

  async validate(params, context = {}) {
    const target = resolveTargetLayerData(params['Input Layer'], context, { targetScope: params?.targetScope });
    const errors = [];

    if (!target.ok || !target.targetGeoJSON) {
      errors.push(
        target.mode === 'selection-empty'
          ? 'No selected features in the chosen layer.'
          : 'No input layer selected.'
      );
    } else if (!targetFeatures(target.targetGeoJSON).length) {
      errors.push('Input layer has no polygon features.');
    }

    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const target = resolveTargetLayerData(params['Input Layer'], context, { targetScope: params?.targetScope });
    const dissolveField = String(params['Dissolve Field'] || '').trim();
    const turfLib = globalThis.turf;

    if (!target.ok || !target.targetGeoJSON || !turfLib?.union) {
      this.setStatus(2, 'A valid polygon input layer is required.');
      return;
    }

    const polygons = targetFeatures(target.targetGeoJSON);
    if (!polygons.length) {
      this.setStatus(2, 'Input layer has no polygon features.');
      return;
    }

    const groups = new Map();
    if (!dissolveField) {
      groups.set('__all__', {
        rawValue: null,
        features: polygons,
      });
    } else {
      polygons.forEach((feature) => {
        const rawValue = feature?.properties?.[dissolveField] ?? null;
        const groupKey = rawValue === null ? '__null__' : `val:${String(rawValue)}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            rawValue,
            features: [],
          });
        }
        groups.get(groupKey).features.push(feature);
      });
    }

    const outputFeatures = [];
    groups.forEach((group) => {
      try {
        const merged = dissolvePolygons(group.features, turfLib);
        if (!merged?.geometry) return;
        const feat = cloneFeature(merged);
        const areaSqm = computeAreaSqm(feat, turfLib);
        feat.properties = {
          ...( dissolveField ? { [dissolveField]: group.rawValue } : {}),
          name: dissolveField
            ? `${dissolveField}: ${group.rawValue ?? 'Unassigned'}`
            : `Dissolved ${target.layerId}`,
          dissolvedCount: group.features.length,
          areaSqm,
        };
        outputFeatures.push(feat);
      } catch (_) {}
    });

    if (!outputFeatures.length) {
      this.setStatus(2, 'Dissolve produced no valid polygon geometry.');
      return;
    }

    const dissolveSummary = {
      inputLayerId: target.layerId,
      dissolveField: dissolveField || null,
      inputFeatureCount: polygons.length,
      outputGroupCount: outputFeatures.length,
    };

    const resultGeoJSON = {
      type: 'FeatureCollection',
      features: outputFeatures,
      toolMetadata: {
        name: this.name,
        params: {
          ...params,
          'Input Layer': target.layerId,
          'Dissolve Field': dissolveField,
        },
        parentLayerId: target.layerId,
        target: {
          mode: target.mode,
          selectedFeatureIds: target.selectedFeatureIds,
          selectedFeatureCount: target.selectedFeatureCount,
          totalFeatureCount: target.totalFeatureCount,
        },
        dissolveSummary,
        timestamp: new Date().toISOString(),
      },
    };

    const result = (context.applyResult || applyResult)({ addGeojson: resultGeoJSON });
    if (!result?.ok) {
      this.setStatus(2, 'Failed to add dissolved layer to map.');
      return;
    }

    this.setStatus(
      0,
      dissolveField
        ? `Dissolved ${polygons.length} polygon(s) into ${outputFeatures.length} group(s) by "${dissolveField}".`
        : `Dissolved ${polygons.length} polygon(s) into 1 boundary.`
    );

    return {
      ...result,
      dissolvedGroupCount: outputFeatures.length,
      dissolveSummary,
    };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    const input = document.getElementById('param-Input Layer');
    if (!input) return;
    input.innerHTML = '';
    const active = typeof getActiveLayerId === 'function' ? getActiveLayerId() : null;
    const layers = listLayers();
    const preferred = paramValues['Input Layer'] || active || layers[0]?.id || null;

    layers.forEach((layer) => {
      const option = document.createElement('option');
      option.value = layer.id;
      option.text = layer.label;
      option.selected = layer.id === preferred;
      input.appendChild(option);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DissolveTool };
} else {
  window.DissolveTool = DissolveTool;
}
