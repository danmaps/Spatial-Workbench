const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');
const { polygonFeatures, dissolvePolygons, targetFeatures, featureId } = require('./overlay');

class EraseTool extends Tool {
  constructor() {
    super('Erase', [new Parameter('Input Layer', 'Layer to erase from', 'dropdown', ''), new Parameter('Erase Layer', 'Polygon layer used to erase', 'dropdown', '')]);
    this.description = 'Erases polygon features using a boundary layer';
    this.headlessSupported = true;
    this.execution = { stateMode: 'layers', inputs: [{ parameter: 'Input Layer', kind: 'layer', geometryTypes: ['Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: true }, { parameter: 'Erase Layer', kind: 'layer', geometryTypes: ['Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: false }], outputs: [{ kind: 'layer', operation: 'add', geometryType: 'Polygon' }], mutatesState: true, producesArtifacts: false };
  }

  async validate(params, context = {}) {
    const target = resolveTargetLayerData(params['Input Layer'], context);
    const eraseLayer = context.getLayer ? context.getLayer(params['Erase Layer']) : null;
    const errors = [];
    if (!target.ok || !target.targetGeoJSON) errors.push('No input layer selected.');
    if (!eraseLayer) errors.push('No erase layer selected.');
    else if (!polygonFeatures(eraseLayer).length) errors.push('Erase layer has no polygon features.');
    if (target.ok && !targetFeatures(target.targetGeoJSON).length) errors.push('Input layer has no polygon features.');
    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const target = resolveTargetLayerData(params['Input Layer'], context);
    const eraseLayer = context.getLayer ? context.getLayer(params['Erase Layer']) : null;
    const turfLib = globalThis.turf;
    if (!target.ok || !eraseLayer || !turfLib?.difference) { this.setStatus(2, 'Input and erase layers are required.'); return; }
    const mask = dissolvePolygons(polygonFeatures(eraseLayer), turfLib);
    const output = [];
    targetFeatures(target.targetGeoJSON).forEach((feature, index) => { try { const erased = turfLib.difference(feature, mask); if (erased) { const next = JSON.parse(JSON.stringify(erased)); next.properties = { ...(next.properties || {}), __sourceFeatureId: featureId(feature, target.layerId, index) }; output.push(next); } } catch (_) {} });
    if (!output.length) { this.setStatus(0, 'Erase produced no remaining features.'); return { erasedCount: 0 }; }
    const resultGeoJSON = { type: 'FeatureCollection', features: output, toolMetadata: { name: this.name, params, parentLayerId: target.layerId, overlayLayerId: params['Erase Layer'], target: { mode: target.mode, selectedFeatureIds: target.selectedFeatureIds, selectedFeatureCount: target.selectedFeatureCount, totalFeatureCount: target.totalFeatureCount }, timestamp: new Date().toISOString() } };
    const result = (context.applyResult || applyResult)({ addGeojson: resultGeoJSON });
    if (!result?.ok) { this.setStatus(2, 'Failed to add erased layer to map.'); return; }
    this.setStatus(0, `Erased ${output.length} feature(s).`);
    return { ...result, erasedCount: output.length };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    ['Input Layer', 'Erase Layer'].forEach((name, index) => { const input = document.getElementById(`param-${name}`); if (!input) return; input.innerHTML = ''; const active = getActiveLayerId(); listLayers().forEach((layer, layerIndex) => { const option = document.createElement('option'); option.value = layer.id; option.text = layer.label; option.selected = layer.id === (paramValues[name] || (index === 0 ? active : null) || (layerIndex === 0 ? layer.id : null)); input.appendChild(option); }); });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { EraseTool };
else window.EraseTool = EraseTool;
