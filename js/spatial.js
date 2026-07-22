function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const SPATIAL_METADATA = Object.freeze({
  crs: 'EPSG:4326',
  coordinateOrder: 'longitude,latitude',
  engine: '@turf/turf',
  measurementModel: 'geodesic/web-oriented',
  precision: 'not-survey-grade',
});

function createSpatialWarning(input = {}) {
  return {
    code: input.code || 'spatial-warning',
    severity: input.severity || 'warning',
    message: input.message || 'Spatial warning.',
    ...(input.path ? { path: input.path } : {}),
    ...(input.layerId ? { layerId: input.layerId } : {}),
    ...(input.featureId ? { featureId: input.featureId } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
}

function createSpatialError(input = {}) {
  return {
    code: input.code || 'spatial-validation-error',
    message: input.message || 'Invalid spatial input.',
    ...(input.path ? { path: input.path } : {}),
    ...(input.layerId ? { layerId: input.layerId } : {}),
    ...(input.featureId ? { featureId: input.featureId } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
}

function createSpatialSession(seedWarnings = []) {
  const warnings = [];
  const seen = new Set();

  function addWarning(input) {
    const warning = createSpatialWarning(input);
    const key = JSON.stringify(warning);
    if (seen.has(key)) return warning;
    seen.add(key);
    warnings.push(warning);
    return warning;
  }

  (Array.isArray(seedWarnings) ? seedWarnings : []).forEach(addWarning);

  return {
    addWarning,
    addWarnings(items) {
      (Array.isArray(items) ? items : []).forEach(addWarning);
    },
    getWarnings() {
      return warnings.map((warning) => ({ ...warning }));
    },
    toJSON() {
      return {
        ...SPATIAL_METADATA,
        warnings: warnings.map((warning) => ({ ...warning })),
      };
    },
  };
}

let generatedFeatureIdCounter = 0;

function createGeneratedFeatureId(prefix = 'feature') {
  generatedFeatureIdCounter += 1;
  return `${prefix}-${generatedFeatureIdCounter}`;
}

function ensureFeatureId(feature, fallbackPrefix = 'feature') {
  if (!feature || feature.type !== 'Feature') return null;
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
  const stableId = feature.properties.__id || feature.id || fallbackPrefix || createGeneratedFeatureId('feature');
  feature.properties.__id = stableId;
  if (feature.id === undefined || feature.id === null || feature.id === '') {
    feature.id = stableId;
  }
  return stableId;
}

function positionsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length < 2 || right.length < 2) return false;
  return Number(left[0]) === Number(right[0]) && Number(left[1]) === Number(right[1]);
}

function validatePosition(position, path, errors, warnings, location = {}) {
  if (!Array.isArray(position) || position.length < 2) {
    errors.push(createSpatialError({
      code: 'coordinate-position-invalid',
      message: 'Coordinate positions must be arrays with at least two numeric values.',
      path,
      ...location,
    }));
    return;
  }

  const longitude = Number(position[0]);
  const latitude = Number(position[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    errors.push(createSpatialError({
      code: 'coordinate-not-finite',
      message: 'Coordinate values must be finite numbers.',
      path,
      ...location,
    }));
    return;
  }

  const longitudeInRange = longitude >= -180 && longitude <= 180;
  const latitudeInRange = latitude >= -90 && latitude <= 90;
  if (longitudeInRange && latitudeInRange) {
    return;
  }

  if (Math.abs(longitude) > 1000 || Math.abs(latitude) > 1000) {
    warnings.push(createSpatialWarning({
      code: 'coordinates-look-projected',
      message: 'Coordinates strongly resemble a projected CRS rather than EPSG:4326 longitude/latitude.',
      path,
      ...location,
    }));
  } else if (Math.abs(longitude) <= 90 && Math.abs(latitude) <= 180 && Math.abs(latitude) > 90) {
    warnings.push(createSpatialWarning({
      code: 'coordinates-look-reversed',
      message: 'Coordinates look like latitude/longitude may be reversed.',
      path,
      ...location,
    }));
  }

  errors.push(createSpatialError({
    code: 'coordinate-out-of-range',
    message: 'Coordinates fall outside the valid EPSG:4326 longitude/latitude range.',
    path,
    ...location,
    details: {
      longitude,
      latitude,
    },
  }));
}

function validateCoordinateArray(coordinates, path, errors, warnings, location = {}) {
  if (!Array.isArray(coordinates)) {
    errors.push(createSpatialError({
      code: 'coordinates-invalid',
      message: 'Geometry coordinates must be arrays.',
      path,
      ...location,
    }));
    return;
  }

  if (!coordinates.length) {
    errors.push(createSpatialError({
      code: 'coordinates-empty',
      message: 'Geometry coordinates cannot be empty.',
      path,
      ...location,
    }));
    return;
  }

  if (typeof coordinates[0] === 'number') {
    validatePosition(coordinates, path, errors, warnings, location);
    return;
  }

  coordinates.forEach((entry, index) => {
    validateCoordinateArray(entry, `${path}[${index}]`, errors, warnings, location);
  });
}

function validateGeometry(geometry, path, errors, warnings, location = {}) {
  if (geometry === null) {
    warnings.push(createSpatialWarning({
      code: 'geometry-null',
      message: 'Feature geometry is null and may be skipped by geometry-producing tools.',
      path,
      ...location,
    }));
    return;
  }

  if (!geometry || typeof geometry !== 'object' || typeof geometry.type !== 'string') {
    errors.push(createSpatialError({
      code: 'geometry-invalid',
      message: 'Geometry must be an object with a valid GeoJSON type.',
      path,
      ...location,
    }));
    return;
  }

  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) {
      errors.push(createSpatialError({
        code: 'geometry-collection-invalid',
        message: 'GeometryCollection.geometries must be an array.',
        path: `${path}.geometries`,
        ...location,
      }));
      return;
    }
    geometry.geometries.forEach((entry, index) => {
      validateGeometry(entry, `${path}.geometries[${index}]`, errors, warnings, location);
    });
    return;
  }

  validateCoordinateArray(geometry.coordinates, `${path}.coordinates`, errors, warnings, location);

  if (geometry.type === 'LineString' && geometry.coordinates.length < 2) {
    errors.push(createSpatialError({
      code: 'linestring-too-short',
      message: 'LineString geometries need at least two positions.',
      path: `${path}.coordinates`,
      ...location,
    }));
  }

  if (geometry.type === 'MultiLineString') {
    geometry.coordinates.forEach((line, index) => {
      if (!Array.isArray(line) || line.length < 2) {
        errors.push(createSpatialError({
          code: 'multilinestring-too-short',
          message: 'Each MultiLineString part needs at least two positions.',
          path: `${path}.coordinates[${index}]`,
          ...location,
        }));
      }
    });
  }

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring, index) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        errors.push(createSpatialError({
          code: 'polygon-ring-too-short',
          message: 'Polygon rings need at least four positions.',
          path: `${path}.coordinates[${index}]`,
          ...location,
        }));
        return;
      }
      if (!positionsEqual(ring[0], ring[ring.length - 1])) {
        errors.push(createSpatialError({
          code: 'polygon-ring-not-closed',
          message: 'Polygon rings must be closed.',
          path: `${path}.coordinates[${index}]`,
          ...location,
        }));
      }
    });
  }

  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4) {
          errors.push(createSpatialError({
            code: 'multipolygon-ring-too-short',
            message: 'MultiPolygon rings need at least four positions.',
            path: `${path}.coordinates[${polygonIndex}][${ringIndex}]`,
            ...location,
          }));
          return;
        }
        if (!positionsEqual(ring[0], ring[ring.length - 1])) {
          errors.push(createSpatialError({
            code: 'multipolygon-ring-not-closed',
            message: 'MultiPolygon rings must be closed.',
            path: `${path}.coordinates[${polygonIndex}][${ringIndex}]`,
            ...location,
          }));
        }
      });
    });
  }
}

function validateFeature(feature, path, errors, warnings, fallbackPrefix, location = {}) {
  if (!feature || feature.type !== 'Feature') {
    errors.push(createSpatialError({
      code: 'feature-invalid',
      message: 'FeatureCollection members must be GeoJSON Feature objects.',
      path,
      ...location,
    }));
    return null;
  }

  const featureId = ensureFeatureId(feature, fallbackPrefix);
  validateGeometry(feature.geometry, `${path}.geometry`, errors, warnings, { ...location, featureId });
  return featureId;
}

function validateGeojson(geojson, path, errors, warnings, options = {}) {
  const location = {
    ...(options.layerId ? { layerId: options.layerId } : {}),
  };

  if (!geojson || typeof geojson !== 'object' || typeof geojson.type !== 'string') {
    errors.push(createSpatialError({
      code: 'geojson-invalid',
      message: 'GeoJSON input must be an object with a valid type.',
      path,
      ...location,
    }));
    return;
  }

  if (geojson.type === 'FeatureCollection') {
    if (!Array.isArray(geojson.features)) {
      errors.push(createSpatialError({
        code: 'featurecollection-invalid',
        message: 'FeatureCollection.features must be an array.',
        path: `${path}.features`,
        ...location,
      }));
      return;
    }

    const geometryTypes = new Set();
    geojson.features.forEach((feature, index) => {
      const featureId = validateFeature(
        feature,
        `${path}.features[${index}]`,
        errors,
        warnings,
        options.featurePrefix ? `${options.featurePrefix}-${index + 1}` : `${options.layerId || 'feature'}-${index + 1}`,
        location
      );
      if (feature?.geometry?.type) geometryTypes.add(feature.geometry.type);
      if (featureId && feature?.geometry == null && options.toolKey && ['BufferTool', 'GroupTool'].includes(options.toolKey)) {
        warnings.push(createSpatialWarning({
          code: 'geometry-required-by-tool',
          message: `${options.toolKey} requires feature geometry and will skip null geometries.`,
          path: `${path}.features[${index}].geometry`,
          ...location,
          featureId,
        }));
      }
    });

    if (geometryTypes.size > 1) {
      warnings.push(createSpatialWarning({
        code: 'mixed-geometry-types',
        message: 'FeatureCollection contains mixed geometry types.',
        path,
        ...location,
        details: {
          geometryTypes: Array.from(geometryTypes).sort(),
        },
      }));
    }
    return;
  }

  if (geojson.type === 'Feature') {
    validateFeature(geojson, path, errors, warnings, options.featurePrefix || options.layerId || 'feature', location);
    return;
  }

  validateGeometry(geojson, path, errors, warnings, location);
}

function normalizeLayerState(rawState, errors, warnings, toolKey) {
  const state = deepClone(rawState || {});
  const rawLayers = Array.isArray(state.layers) ? state.layers : [];
  state.layers = rawLayers.map((entry, index) => {
    const layer = entry && typeof entry === 'object' ? { ...entry } : { geojson: entry };
    const layerId = layer.id || `layer-${index + 1}`;
    const geojson = deepClone(layer.geojson ?? layer.data ?? layer);
    layer.id = layerId;
    layer.name = layer.name || layerId;
    layer.geojson = geojson;
    validateGeojson(geojson, `state.layers[${index}].geojson`, errors, warnings, {
      toolKey,
      layerId,
      featurePrefix: layerId,
    });
    return layer;
  });

  if (state.bbox !== undefined && state.bbox !== null) {
    if (!Array.isArray(state.bbox) || state.bbox.length !== 4) {
      errors.push(createSpatialError({
        code: 'bbox-invalid',
        message: 'state.bbox must be an array of [west, south, east, north].',
        path: 'state.bbox',
      }));
    } else {
      validatePosition([state.bbox[0], state.bbox[1]], 'state.bbox', errors, warnings);
      validatePosition([state.bbox[2], state.bbox[3]], 'state.bbox', errors, warnings);
    }
  }

  return state;
}

function normalizeFeatureCollectionState(rawState, errors, warnings, toolKey) {
  const state = deepClone(rawState || {});
  const featureCollection = state.featureCollection && state.featureCollection.type === 'FeatureCollection'
    ? state.featureCollection
    : { type: 'FeatureCollection', features: [] };
  state.featureCollection = featureCollection;
  validateGeojson(featureCollection, 'state.featureCollection', errors, warnings, {
    toolKey,
    featurePrefix: 'feature',
  });
  if (!state.selection || typeof state.selection !== 'object') {
    state.selection = { featureIds: [] };
  }
  if (!Array.isArray(state.selection.featureIds)) {
    state.selection.featureIds = [];
  }
  return state;
}

function normalizeSpatialRequest({ toolKey, state = {} }) {
  const errors = [];
  const warnings = [];
  const rawState = state || {};
  const normalizedState = rawState.featureCollection
    ? normalizeFeatureCollectionState(rawState, errors, warnings, toolKey)
    : normalizeLayerState(rawState, errors, warnings, toolKey);

  return {
    ok: errors.length === 0,
    state: normalizedState,
    validation: {
      ok: errors.length === 0,
      errors,
    },
    warnings,
  };
}

module.exports = {
  SPATIAL_METADATA,
  createSpatialError,
  createSpatialSession,
  createSpatialWarning,
  ensureFeatureId,
  normalizeSpatialRequest,
};
