const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');
const { featureId, featuresFromGeoJSON, intersectPolygons } = require('./overlay');

const PREDICATES = ['intersects', 'within', 'within_distance'];
const JOIN_MODES = ['first_match', 'summary'];
const DISTANCE_UNITS = ['feet', 'meters', 'miles', 'kilometers', 'degrees'];

function cloneFeature(feature) {
  return feature == null ? null : JSON.parse(JSON.stringify(feature));
}

function testWithin(targetFeature, joinFeature, turfLib) {
  const targetType = targetFeature?.geometry?.type;
  const joinType = joinFeature?.geometry?.type;

  if (
    targetType === 'Point' &&
    (joinType === 'Polygon' || joinType === 'MultiPolygon') &&
    typeof turfLib?.booleanPointInPolygon === 'function'
  ) {
    try {
      return Boolean(turfLib.booleanPointInPolygon(targetFeature, joinFeature));
    } catch (_) {}
  }

  if (typeof turfLib?.booleanWithin === 'function') {
    try {
      return Boolean(turfLib.booleanWithin(targetFeature, joinFeature));
    } catch (_) {}
  }

  if (
    (joinType === 'Polygon' || joinType === 'MultiPolygon') &&
    typeof turfLib?.centroid === 'function' &&
    typeof turfLib?.booleanPointInPolygon === 'function'
  ) {
    try {
      const center = turfLib.centroid(targetFeature);
      return Boolean(turfLib.booleanPointInPolygon(center, joinFeature));
    } catch (_) {}
  }

  return false;
}

function testIntersects(targetFeature, joinFeature, turfLib) {
  if (typeof turfLib?.booleanIntersects === 'function') {
    try {
      return Boolean(turfLib.booleanIntersects(targetFeature, joinFeature));
    } catch (_) {}
  }

  if (testWithin(targetFeature, joinFeature, turfLib) || testWithin(joinFeature, targetFeature, turfLib)) {
    return true;
  }

  const targetType = targetFeature?.geometry?.type;
  const joinType = joinFeature?.geometry?.type;
  if (
    (targetType === 'Polygon' || targetType === 'MultiPolygon') &&
    (joinType === 'Polygon' || joinType === 'MultiPolygon') &&
    typeof turfLib?.intersect === 'function'
  ) {
    try {
      return Boolean(intersectPolygons(targetFeature, joinFeature, turfLib));
    } catch (_) {}
  }

  return false;
}

function testWithinDistance(targetFeature, joinFeature, distance, units, turfLib) {
  if (testIntersects(targetFeature, joinFeature, turfLib)) {
    return true;
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    return false;
  }

  if (typeof turfLib?.buffer === 'function') {
    try {
      const buffered = turfLib.buffer(targetFeature, distance, { units });
      if (buffered && testIntersects(buffered, joinFeature, turfLib)) {
        return true;
      }
    } catch (_) {}
  }

  if (typeof turfLib?.distance === 'function' && typeof turfLib?.centroid === 'function') {
    try {
      const ptA = targetFeature?.geometry?.type === 'Point' ? targetFeature : turfLib.centroid(targetFeature);
      const ptB = joinFeature?.geometry?.type === 'Point' ? joinFeature : turfLib.centroid(joinFeature);
      const d = turfLib.distance(ptA, ptB, { units });
      return Number.isFinite(d) && d <= distance;
    } catch (_) {}
  }

  return false;
}

function matchesPredicate(targetFeature, joinFeature, { predicate, distance, units }, turfLib) {
  if (!targetFeature?.geometry || !joinFeature?.geometry) return false;
  if (predicate === 'within') {
    return testWithin(targetFeature, joinFeature, turfLib);
  }
  if (predicate === 'within_distance') {
    return testWithinDistance(targetFeature, joinFeature, distance, units, turfLib);
  }
  return testIntersects(targetFeature, joinFeature, turfLib);
}

function applyJoinedAttributes(targetFeature, matches, joinMode) {
  const next = cloneFeature(targetFeature);
  next.properties = {
    ...(next.properties || {}),
    join_count: matches.length,
    join_matched: matches.length > 0,
  };

  if (!matches.length) {
    return next;
  }

  if (joinMode === 'summary') {
    const numericSums = new Map();
    const numericCounts = new Map();
    const matchedIds = [];

    matches.forEach((joinFeat) => {
      const jProps = joinFeat?.properties || {};
      if (jProps.__id || joinFeat.id) {
        matchedIds.push(jProps.__id || joinFeat.id);
      }
      Object.entries(jProps).forEach(([key, value]) => {
        if (key.startsWith('__')) return;
        if (typeof value === 'number' && Number.isFinite(value)) {
          numericSums.set(key, (numericSums.get(key) || 0) + value);
          numericCounts.set(key, (numericCounts.get(key) || 0) + 1);
        }
      });
    });

    numericSums.forEach((sum, key) => {
      const count = numericCounts.get(key) || 1;
      next.properties[`join_${key}_sum`] = Number(sum.toFixed(4));
      next.properties[`join_${key}_mean`] = Number((sum / count).toFixed(4));
    });
    next.properties.join_feature_ids = matchedIds;
    return next;
  }

  // Default: first_match
  const firstMatch = matches[0];
  const jProps = firstMatch?.properties || {};
  next.properties.join_feature_id = jProps.__id || firstMatch?.id || null;

  Object.entries(jProps).forEach(([key, value]) => {
    if (key.startsWith('__')) return;
    const outKey = Object.prototype.hasOwnProperty.call(next.properties, key)
      ? `join_${key}`
      : key;
    next.properties[outKey] = value;
  });

  return next;
}

class SpatialJoinTool extends Tool {
  constructor() {
    super('Spatial Join', [
      new Parameter('Target Layer', 'Target layer receiving joined attributes', 'dropdown', '', null, null, null, true),
      new Parameter('Join Layer', 'Source layer providing attributes to join', 'dropdown', '', null, null, null, true),
      new Parameter('Predicate', 'Spatial relationship predicate', 'dropdown', 'intersects', PREDICATES, null, null, true),
      new Parameter('Distance', 'Search distance (for within_distance)', 'float', 100, null, 0, null, false),
      new Parameter('Units', 'Distance units (for within_distance)', 'dropdown', 'meters', DISTANCE_UNITS, null, null, true),
      new Parameter('Join Mode', 'How matching join features are combined', 'dropdown', 'first_match', JOIN_MODES, null, null, true),
    ]);
    this.description = 'Joins attributes from a join layer onto a target layer by spatial predicate (intersects, within, or within_distance)';
    this.headlessSupported = true;
    this.execution = {
      stateMode: 'layers',
      inputs: [
        {
          parameter: 'Target Layer',
          kind: 'layer',
          geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
          cardinality: 'one',
          selectionAware: true,
        },
        {
          parameter: 'Join Layer',
          kind: 'layer',
          geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
          cardinality: 'one',
          selectionAware: false,
        },
      ],
      outputs: [{ kind: 'layer', operation: 'add', geometryType: 'Mixed' }],
      mutatesState: true,
      producesArtifacts: false,
    };
  }

  async validate(params, context = {}) {
    const resolveLayer = context.getLayer;
    const target = resolveTargetLayerData(params['Target Layer'], context, { targetScope: params?.targetScope });
    const joinLayer = resolveLayer && params['Join Layer'] ? resolveLayer(params['Join Layer']) : null;
    const predicate = String(params['Predicate'] || 'intersects').toLowerCase();
    const joinMode = String(params['Join Mode'] || 'first_match').toLowerCase();
    const units = String(params['Units'] || 'meters').toLowerCase();
    const errors = [];

    if (!target.ok || !target.targetGeoJSON) {
      errors.push(
        target.mode === 'selection-empty'
          ? 'No selected features in the chosen layer.'
          : 'No target layer selected.'
      );
    } else if (!featuresFromGeoJSON(target.targetGeoJSON).length) {
      errors.push('Target layer has no features.');
    }

    if (!joinLayer || typeof joinLayer.toGeoJSON !== 'function') {
      errors.push('No join layer selected.');
    } else if (!featuresFromGeoJSON(joinLayer.toGeoJSON()).length) {
      errors.push('Join layer has no features.');
    }

    if (!PREDICATES.includes(predicate)) {
      errors.push(`Predicate must be one of: ${PREDICATES.join(', ')}.`);
    }

    if (!JOIN_MODES.includes(joinMode)) {
      errors.push(`Join Mode must be one of: ${JOIN_MODES.join(', ')}.`);
    }

    if (predicate === 'within_distance') {
      const distance = parseFloat(params['Distance']);
      if (!Number.isFinite(distance) || distance < 0) {
        errors.push('Distance must be a non-negative number for within_distance.');
      }
      if (!DISTANCE_UNITS.includes(units)) {
        errors.push(`Unsupported distance units: ${params['Units']}.`);
      }
    }

    return this.validationFailure(errors);
  }

  async run(params, context = {}) {
    const resolveLayer = context.getLayer;
    const target = resolveTargetLayerData(params['Target Layer'], context, { targetScope: params?.targetScope });
    const joinLayerId = params['Join Layer'];
    const joinLayer = resolveLayer && joinLayerId ? resolveLayer(joinLayerId) : null;
    const predicate = String(params['Predicate'] || 'intersects').toLowerCase();
    const joinMode = String(params['Join Mode'] || 'first_match').toLowerCase();
    const distance = parseFloat(params['Distance'] ?? 100);
    const units = String(params['Units'] || 'meters').toLowerCase();
    const turfLib = globalThis.turf;

    if (!target.ok || !target.targetGeoJSON || !joinLayer) {
      this.setStatus(2, 'Target Layer and Join Layer are required.');
      return;
    }

    const targetFeatures = featuresFromGeoJSON(target.targetGeoJSON).map((feat, idx) => {
      const cloned = cloneFeature(feat);
      featureId(cloned, target.layerId, idx);
      return cloned;
    });
    const joinFeatures = featuresFromGeoJSON(joinLayer.toGeoJSON()).map((feat, idx) => {
      const cloned = cloneFeature(feat);
      featureId(cloned, joinLayerId, idx);
      return cloned;
    });

    let matchedTargetCount = 0;
    let totalJoinPairs = 0;

    const outputFeatures = targetFeatures.map((targetFeat) => {
      const matches = joinFeatures.filter((joinFeat) =>
        matchesPredicate(targetFeat, joinFeat, { predicate, distance, units }, turfLib)
      );
      if (matches.length > 0) {
        matchedTargetCount += 1;
        totalJoinPairs += matches.length;
      }
      return applyJoinedAttributes(targetFeat, matches, joinMode);
    });

    const joinSummary = {
      targetLayerId: target.layerId,
      joinLayerId,
      predicate,
      joinMode,
      ...(predicate === 'within_distance' ? { distance, units } : {}),
      targetFeatureCount: targetFeatures.length,
      joinFeatureCount: joinFeatures.length,
      matchedTargetCount,
      unmatchedTargetCount: targetFeatures.length - matchedTargetCount,
      totalJoinPairs,
    };

    const resultGeoJSON = {
      type: 'FeatureCollection',
      features: outputFeatures,
      toolMetadata: {
        name: this.name,
        params: {
          ...params,
          'Target Layer': target.layerId,
          'Join Layer': joinLayerId,
        },
        parentLayerId: target.layerId,
        overlayLayerId: joinLayerId,
        target: {
          mode: target.mode,
          selectedFeatureIds: target.selectedFeatureIds,
          selectedFeatureCount: target.selectedFeatureCount,
          totalFeatureCount: target.totalFeatureCount,
        },
        joinSummary,
        timestamp: new Date().toISOString(),
      },
    };

    const result = (context.applyResult || applyResult)({ addGeojson: resultGeoJSON });
    if (!result?.ok) {
      this.setStatus(2, 'Failed to add spatial join layer to map.');
      return;
    }

    this.setStatus(
      0,
      `Joined ${joinLayerId} onto ${target.layerId} (${matchedTargetCount} of ${targetFeatures.length} feature(s) matched via ${predicate}).`
    );

    return {
      ...result,
      matchedTargetCount,
      joinSummary,
    };
  }

  renderUI(paramValues = {}) {
    super.renderUI(paramValues);
    const layers = listLayers();
    const active = typeof getActiveLayerId === 'function' ? getActiveLayerId() : null;

    ['Target Layer', 'Join Layer'].forEach((name, index) => {
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

    ['Predicate', 'Units', 'Join Mode'].forEach((paramName) => {
      const paramDef = this.parameters.find((p) => p.name === paramName);
      const selectEl = document.getElementById(`param-${paramName}`);
      if (!paramDef || !selectEl || !Array.isArray(paramDef.options)) return;
      selectEl.innerHTML = '';
      const currentVal = paramValues[paramName] || paramDef.defaultValue;
      paramDef.options.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt;
        option.text = opt;
        option.selected = String(opt).toLowerCase() === String(currentVal).toLowerCase();
        selectEl.appendChild(option);
      });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpatialJoinTool };
} else {
  window.SpatialJoinTool = SpatialJoinTool;
}
