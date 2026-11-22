const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');
const {
  computeAreaSqm,
  differencePolygons,
  dissolvePolygons,
  intersectPolygons,
  polygonFeatures,
  targetFeatures,
} = require('./overlay');

function cloneFeature(feature) {
  return feature == null ? null : JSON.parse(JSON.stringify(feature));
}

class CompareTool extends Tool {
  constructor() {
    super('Compare', [
      new Parameter('Layer A', 'Baseline polygon layer (A)', 'dropdown', '', null, null, null, true),
      new Parameter('Layer B', 'Comparison polygon layer (B)', 'dropdown', '', null, null, null, true),
    ]);
    this.description = 'Compares two polygon layers (A vs B) and computes intersection, only-in-A, only-in-B, and area deltas';
    this.headlessSupported = true;
    this.execution = {
      stateMode: 'layers',
      inputs: [
        {
          parameter: 'Layer A',
          kind: 'layer',
          geometryTypes: ['Polygon', 'MultiPolygon'],
          cardinality: 'one',
          selectionAware: true,
        },
        {
          parameter: 'Layer B',
          kind: 'layer',
          geometryTypes: ['Polygon', 'MultiPolygon'],
          cardinality: 'one',
          selectionAware: false,
        },
      ],
      outputs: [{ kind: 'layer', operation: 'add', geometryType: 'Polygon' }],
      mutatesState: true,
      producesArtifacts: false,
    };
  }

  async validate(params, context = {}) {
    const resolveLayer = context.getLayer;
    const targetA = resolveTargetLayerData(params['Layer A'], context, { targetScope: params?.targetScope });
    const layerB = resolveLayer ? resolveLayer(params['Layer B']) : null;
    const errors = [];

    if (!targetA.ok || !targetA.targetGeoJSON) {
      errors.push(
        targetA.mode === 'selection-empty'
          ? 'No selected features in the chosen layer.'
          : 'No baseline Layer A selected.'
      );
    } else if (!targetFeatures(targetA.targetGeoJSON).length) {
      errors.push('Layer A has no polygon features.');
    }

    if (!layerB) {
      errors.push('No comparison Layer B selected.');
    } else if (!polygonFeatures(layerB).length) {
      errors.push('Layer B has no polygon features.');
    }

    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const resolveLayer = context.getLayer;
    const targetA = resolveTargetLayerData(params['Layer A'], context, { targetScope: params?.targetScope });
    const layerBId = params['Layer B'];
    const layerB = resolveLayer ? resolveLayer(layerBId) : null;
    const turfLib = globalThis.turf;

    if (!targetA.ok || !layerB || !turfLib?.intersect || !turfLib?.difference) {
      this.setStatus(2, 'Layer A and Layer B polygon layers are required.');
      return;
    }

    const featuresA = targetFeatures(targetA.targetGeoJSON);
    const featuresB = polygonFeatures(layerB);
    if (!featuresA.length || !featuresB.length) {
      this.setStatus(2, 'Layer A and Layer B must both contain polygon features.');
      return;
    }

    const maskA = dissolvePolygons(featuresA, turfLib);
    const maskB = dissolvePolygons(featuresB, turfLib);

    let intersectionFeature = null;
    let onlyInAFeature = null;
    let onlyInBFeature = null;

    try {
      intersectionFeature = intersectPolygons(maskA, maskB, turfLib);
    } catch (_) {}

    try {
      onlyInAFeature = differencePolygons(maskA, maskB, turfLib);
    } catch (_) {}

    try {
      onlyInBFeature = differencePolygons(maskB, maskA, turfLib);
    } catch (_) {}

    const areaASqm = computeAreaSqm(maskA, turfLib);
    const areaBSqm = computeAreaSqm(maskB, turfLib);
    const intersectionAreaSqm = computeAreaSqm(intersectionFeature, turfLib);
    const onlyInAAreaSqm = computeAreaSqm(onlyInAFeature, turfLib);
    const onlyInBAreaSqm = computeAreaSqm(onlyInBFeature, turfLib);
    const areaDeltaSqm = Number((areaBSqm - areaASqm).toFixed(2));
    const unionAreaSqm = Number((intersectionAreaSqm + onlyInAAreaSqm + onlyInBAreaSqm).toFixed(2));
    const jaccardSimilarity = unionAreaSqm > 0
      ? Number((intersectionAreaSqm / unionAreaSqm).toFixed(4))
      : 0;

    const outputFeatures = [];
    if (intersectionFeature?.geometry) {
      const feat = cloneFeature(intersectionFeature);
      feat.properties = {
        ...(feat.properties || {}),
        name: 'Overlap (A ∩ B)',
        comparisonRole: 'intersection',
        areaSqm: intersectionAreaSqm,
        layerAId: targetA.layerId,
        layerBId,
      };
      outputFeatures.push(feat);
    }

    if (onlyInAFeature?.geometry) {
      const feat = cloneFeature(onlyInAFeature);
      feat.properties = {
        ...(feat.properties || {}),
        name: 'Only in A (A - B)',
        comparisonRole: 'only-in-a',
        areaSqm: onlyInAAreaSqm,
        layerAId: targetA.layerId,
        layerBId,
      };
      outputFeatures.push(feat);
    }

    if (onlyInBFeature?.geometry) {
      const feat = cloneFeature(onlyInBFeature);
      feat.properties = {
        ...(feat.properties || {}),
        name: 'Only in B (B - A)',
        comparisonRole: 'only-in-b',
        areaSqm: onlyInBAreaSqm,
        layerAId: targetA.layerId,
        layerBId,
      };
      outputFeatures.push(feat);
    }

    const comparisonMetrics = {
      layerAId: targetA.layerId,
      layerBId,
      areaASqm,
      areaBSqm,
      intersectionAreaSqm,
      onlyInAAreaSqm,
      onlyInBAreaSqm,
      areaDeltaSqm,
      unionAreaSqm,
      jaccardSimilarity,
      componentCounts: {
        intersection: intersectionFeature?.geometry ? 1 : 0,
        onlyInA: onlyInAFeature?.geometry ? 1 : 0,
        onlyInB: onlyInBFeature?.geometry ? 1 : 0,
      },
    };

    if (!outputFeatures.length) {
      this.setStatus(0, 'Comparison produced no valid output geometry.');
      return {
        comparedCount: 0,
        comparison: comparisonMetrics,
      };
    }

    const resultGeoJSON = {
      type: 'FeatureCollection',
      features: outputFeatures,
      toolMetadata: {
        name: this.name,
        params,
        parentLayerId: targetA.layerId,
        overlayLayerId: layerBId,
        target: {
          mode: targetA.mode,
          selectedFeatureIds: targetA.selectedFeatureIds,
          selectedFeatureCount: targetA.selectedFeatureCount,
          totalFeatureCount: targetA.totalFeatureCount,
        },
        comparison: comparisonMetrics,
        timestamp: new Date().toISOString(),
      },
    };

    const result = (context.applyResult || applyResult)({ addGeojson: resultGeoJSON });
    if (!result?.ok) {
      this.setStatus(2, 'Failed to add comparison layer to map.');
      return;
    }

    const overlapPct = (jaccardSimilarity * 100).toFixed(1);
    const deltaPrefix = areaDeltaSqm >= 0 ? '+' : '';
    this.setStatus(
      0,
      `Compared ${targetA.layerId} vs ${layerBId} (${overlapPct}% overlap, Δ area ${deltaPrefix}${areaDeltaSqm} sq m).`
    );

    return {
      ...result,
      comparedCount: outputFeatures.length,
      comparison: comparisonMetrics,
    };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    const layers = listLayers();
    const active = typeof getActiveLayerId === 'function' ? getActiveLayerId() : null;

    ['Layer A', 'Layer B'].forEach((name, index) => {
      const input = document.getElementById(`param-${name}`);
      if (!input) return;
      input.innerHTML = '';

      const fallbackId = index === 0
        ? (active || layers[0]?.id || null)
        : (layers.find((l) => l.id !== active)?.id || layers[1]?.id || layers[0]?.id || null);
      const preferred = paramValues[name] || fallbackId;

      layers.forEach((layer) => {
        const option = document.createElement('option');
        option.value = layer.id;
        option.text = layer.label;
        option.selected = layer.id === preferred;
        input.appendChild(option);
      });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CompareTool };
} else {
  window.CompareTool = CompareTool;
}
