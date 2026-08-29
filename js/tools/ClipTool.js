const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');
const { polygonFeatures, dissolvePolygons, intersectPolygons, targetFeatures } = require('./overlay');

class ClipTool extends Tool {
  constructor() {
    super('Clip', [
      new Parameter('Input Layer', 'Layer to clip', 'dropdown', ''),
      new Parameter('Clip Layer', 'Polygon layer used as the boundary', 'dropdown', ''),
    ]);
    this.description = 'Clips polygon features by a boundary layer';
    this.headlessSupported = true;
    this.execution = { stateMode: 'layers', inputs: [
      { parameter: 'Input Layer', kind: 'layer', geometryTypes: ['Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: true },
      { parameter: 'Clip Layer', kind: 'layer', geometryTypes: ['Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: false },
    ], outputs: [{ kind: 'layer', operation: 'add', geometryType: 'Polygon' }], mutatesState: true, producesArtifacts: false };
  }

  async validate(params, context = {}) {
    const resolveLayer = context.getLayer;
    const target = resolveTargetLayerData(params['Input Layer'], context);
    const clipLayer = resolveLayer ? resolveLayer(params['Clip Layer']) : null;
    const errors = [];
    if (!target.ok || !target.targetGeoJSON) errors.push('No input layer selected.');
    if (!clipLayer) errors.push('No clip layer selected.');
    else if (!polygonFeatures(clipLayer).length) errors.push('Clip layer has no polygon features.');
    if (target.ok && !targetFeatures(target.targetGeoJSON).length) errors.push('Input layer has no polygon features.');
    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const resolveLayer = context.getLayer;
    const target = resolveTargetLayerData(params['Input Layer'], context);
    const clipLayer = resolveLayer ? resolveLayer(params['Clip Layer']) : null;
    const turfLib = globalThis.turf;
    if (!target.ok || !clipLayer || !turfLib?.intersect) { this.setStatus(2, 'Input and clip layers are required.'); return; }
    const mask = dissolvePolygons(polygonFeatures(clipLayer), turfLib);
    const features = targetFeatures(target.targetGeoJSON);
    const output = [];
    features.forEach((feature) => { try { const clipped = intersectPolygons(feature, mask, turfLib); if (clipped) output.push(clipped); } catch (_) {} });
    if (!output.length) { this.setStatus(0, 'Clip produced no intersecting features.'); return { clippedCount: 0 }; }
    const resultGeoJSON = { type: 'FeatureCollection', features: output, toolMetadata: { name: this.name, params, parentLayerId: target.layerId, overlayLayerId: params['Clip Layer'], target: { mode: target.mode, selectedFeatureIds: target.selectedFeatureIds, selectedFeatureCount: target.selectedFeatureCount, totalFeatureCount: target.totalFeatureCount }, timestamp: new Date().toISOString() } };
    const result = (context.applyResult || applyResult)({ addGeojson: resultGeoJSON });
    if (!result?.ok) { this.setStatus(2, 'Failed to add clipped layer to map.'); return; }
    this.setStatus(0, `Clipped ${output.length} feature(s).`);
    return { ...result, clippedCount: output.length };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    ['Input Layer', 'Clip Layer'].forEach((name, index) => {
      const input = document.getElementById(`param-${name}`); if (!input) return;
      input.innerHTML = '';
      const active = getActiveLayerId();
      listLayers().forEach((layer, layerIndex) => { const option = document.createElement('option'); option.value = layer.id; option.text = layer.label; option.selected = layer.id === (paramValues[name] || (index === 0 ? active : null) || (layerIndex === 0 ? layer.id : null)); input.appendChild(option); });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ClipTool };
else window.ClipTool = ClipTool;
