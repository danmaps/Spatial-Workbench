const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId } = require('../state');
const { buildTargetMetadata, buildToolHistory, getTargetToolHistory, resolveTargetLayerData } = require('./targeting');

const EXPORT_ALL_LAYERS_VALUE = '__all__';
const SUPPORTED_EXPORT_FORMATS = Object.freeze({
    geojson: { label: 'GeoJSON', extension: 'geojson', mimeType: 'application/json' },
    csv: { label: 'CSV', extension: 'csv', mimeType: 'text/csv' },
    wkt: { label: 'WKT', extension: 'wkt', mimeType: 'text/plain' },
});

function normalizeExportFormat(rawFormat) {
    if (typeof rawFormat !== 'string') return null;
    const key = rawFormat.trim().toLowerCase();
    return SUPPORTED_EXPORT_FORMATS[key] ? key : null;
}

function formatCoordinatePair(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const x = Number(coord[0]);
    const y = Number(coord[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (coord.length >= 3 && Number.isFinite(Number(coord[2]))) {
        return `${x} ${y} ${Number(coord[2])}`;
    }
    return `${x} ${y}`;
}

function formatCoordSequence(coords) {
    if (!Array.isArray(coords)) return '';
    return coords.map(formatCoordinatePair).filter(Boolean).join(', ');
}

function geometryToWkt(geometry) {
    if (!geometry || typeof geometry !== 'object' || !geometry.type) return '';
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === 'Point') {
        const pair = formatCoordinatePair(coords);
        return pair ? `POINT (${pair})` : 'POINT EMPTY';
    }
    if (type === 'MultiPoint') {
        if (!Array.isArray(coords) || !coords.length) return 'MULTIPOINT EMPTY';
        const parts = coords
            .map((pt) => {
                const pair = formatCoordinatePair(pt);
                return pair ? `(${pair})` : null;
            })
            .filter(Boolean);
        return parts.length ? `MULTIPOINT (${parts.join(', ')})` : 'MULTIPOINT EMPTY';
    }
    if (type === 'LineString') {
        const seq = formatCoordSequence(coords);
        return seq ? `LINESTRING (${seq})` : 'LINESTRING EMPTY';
    }
    if (type === 'MultiLineString') {
        if (!Array.isArray(coords) || !coords.length) return 'MULTILINESTRING EMPTY';
        const lines = coords
            .map((line) => {
                const seq = formatCoordSequence(line);
                return seq ? `(${seq})` : null;
            })
            .filter(Boolean);
        return lines.length ? `MULTILINESTRING (${lines.join(', ')})` : 'MULTILINESTRING EMPTY';
    }
    if (type === 'Polygon') {
        if (!Array.isArray(coords) || !coords.length) return 'POLYGON EMPTY';
        const rings = coords
            .map((ring) => {
                const seq = formatCoordSequence(ring);
                return seq ? `(${seq})` : null;
            })
            .filter(Boolean);
        return rings.length ? `POLYGON (${rings.join(', ')})` : 'POLYGON EMPTY';
    }
    if (type === 'MultiPolygon') {
        if (!Array.isArray(coords) || !coords.length) return 'MULTIPOLYGON EMPTY';
        const polys = coords
            .map((poly) => {
                if (!Array.isArray(poly)) return null;
                const rings = poly
                    .map((ring) => {
                        const seq = formatCoordSequence(ring);
                        return seq ? `(${seq})` : null;
                    })
                    .filter(Boolean);
                return rings.length ? `(${rings.join(', ')})` : null;
            })
            .filter(Boolean);
        return polys.length ? `MULTIPOLYGON (${polys.join(', ')})` : 'MULTIPOLYGON EMPTY';
    }
    if (type === 'GeometryCollection') {
        const geoms = Array.isArray(geometry.geometries)
            ? geometry.geometries.map(geometryToWkt).filter(Boolean)
            : [];
        return geoms.length ? `GEOMETRYCOLLECTION (${geoms.join(', ')})` : 'GEOMETRYCOLLECTION EMPTY';
    }
    return '';
}

function escapeCsvCell(value) {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function featuresToCsv(features = []) {
    const list = Array.isArray(features) ? features : [];
    const propertyKeys = [];
    const seenKeys = new Set();
    let hasPointGeometry = false;

    list.forEach((feature) => {
        if (feature?.geometry?.type === 'Point') {
            hasPointGeometry = true;
        }
        const props = feature?.properties;
        if (props && typeof props === 'object') {
            Object.keys(props).forEach((key) => {
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    propertyKeys.push(key);
                }
            });
        }
    });

    const columns = [
        ...propertyKeys,
        ...(!seenKeys.has('geometry_type') ? ['geometry_type'] : []),
        ...(hasPointGeometry && !seenKeys.has('longitude') ? ['longitude'] : []),
        ...(hasPointGeometry && !seenKeys.has('latitude') ? ['latitude'] : []),
        ...(!seenKeys.has('wkt') ? ['wkt'] : []),
    ];

    const headerRow = columns.map(escapeCsvCell).join(',');
    const dataRows = list.map((feature) => {
        const props = (feature && typeof feature.properties === 'object' && feature.properties) || {};
        const geom = feature?.geometry || null;
        const isPoint = geom?.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2;
        return columns
            .map((col) => {
                if (Object.prototype.hasOwnProperty.call(props, col)) {
                    return escapeCsvCell(props[col]);
                }
                if (col === 'geometry_type') {
                    return escapeCsvCell(geom?.type || '');
                }
                if (col === 'longitude') {
                    return isPoint ? escapeCsvCell(geom.coordinates[0]) : '';
                }
                if (col === 'latitude') {
                    return isPoint ? escapeCsvCell(geom.coordinates[1]) : '';
                }
                if (col === 'wkt') {
                    return escapeCsvCell(geometryToWkt(geom));
                }
                return '';
            })
            .join(',');
    });

    return [headerRow, ...dataRows].join('\n');
}

function featuresToWktDocument(features = []) {
    const list = Array.isArray(features) ? features : [];
    return list
        .map((feature) => geometryToWkt(feature?.geometry || null))
        .filter(Boolean)
        .join('\n');
}

function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isAllLayersTarget(value) {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === EXPORT_ALL_LAYERS_VALUE || normalized === 'all' || normalized === 'all layers';
}

function extractFeaturesFromGeoJSON(geojson) {
    if (!geojson || typeof geojson !== 'object') return [];
    if (geojson.type === 'FeatureCollection') {
        return Array.isArray(geojson.features) ? geojson.features.filter(Boolean).map(deepClone) : [];
    }
    if (geojson.type === 'Feature') {
        return [deepClone(geojson)];
    }
    return [];
}

function resolveAllExportableLayers(context = {}) {
    const rawList = (typeof context.listLayers === 'function' ? context.listLayers() : null)
        || (Array.isArray(context?.state?.layers) ? context.state.layers : null)
        || (typeof listLayers === 'function' ? listLayers() : [])
        || [];
    const resolveLayer = context.getLayer;
    const resolved = [];

    rawList.forEach((entry, index) => {
        const layerId = entry?.id || `layer-${index + 1}`;
        const layerObj = typeof resolveLayer === 'function' ? resolveLayer(layerId) : null;
        const geojson = (layerObj && typeof layerObj.toGeoJSON === 'function' ? deepClone(layerObj.toGeoJSON()) : null)
            || (entry?.geojson ? deepClone(entry.geojson) : null);
        if (!geojson) return;

        const name = entry?.displayName || entry?.name || entry?.label || layerId;
        const features = extractFeaturesFromGeoJSON(geojson).map((feature, fIdx) => {
            feature.properties = {
                ...(feature.properties || {}),
                __id: feature?.properties?.__id || feature?.id || `${layerId}-${fIdx + 1}`,
                __layerId: layerId,
                __layerName: name,
            };
            if (!feature.id) feature.id = feature.properties.__id;
            return feature;
        });

        const history = getTargetToolHistory({
            layer: layerObj,
            sourceGeoJSON: geojson,
        });

        resolved.push({
            id: layerId,
            name,
            featureCount: features.length,
            features,
            toolMetadata: geojson.toolMetadata ? deepClone(geojson.toolMetadata) : null,
            toolHistory: history,
        });
    });

    return resolved;
}

function addExportMetadata(geojson, target, params, toolName) {
    const exportedGeoJSON = deepClone(geojson);
    if (!exportedGeoJSON || typeof exportedGeoJSON !== 'object') return exportedGeoJSON;

    const toolMetadata = {
        ...(exportedGeoJSON.toolMetadata || {}),
        name: toolName,
        params,
        parentLayerId: target.layerId,
        target: buildTargetMetadata(target),
        timestamp: new Date().toISOString(),
    };
    exportedGeoJSON.toolMetadata = toolMetadata;
    exportedGeoJSON.toolHistory = buildToolHistory(target, toolMetadata);

    return exportedGeoJSON;
}

class ExportTool extends Tool {
    constructor() {
        super("Export", [
            new Parameter("Layer","layer to export","dropdown","", null, null, null, true),
            new Parameter("Format","format to export","dropdown","geojson", ["geojson", "csv", "wkt"], null, null, true)  
        ]);

        this.description = "Export data as GeoJSON, CSV, or WKT";
        this.headlessSupported = true;
        this.execution = { stateMode: 'layers', inputs: [{ parameter: 'Layer', kind: 'layer', geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: true }], outputs: [{ kind: 'artifact', operation: 'create', artifactType: 'download' }], mutatesState: false, producesArtifacts: true };
    }
    async validate(params, context = {}) {
        const inputLayerId = params['Layer'];
        const format = normalizeExportFormat(params['Format'] || 'GeoJSON');
        const errors = [];

        if (!format) {
            errors.push('Unsupported export format.');
        }

        if (isAllLayersTarget(inputLayerId)) {
            const allLayers = resolveAllExportableLayers(context);
            if (!allLayers.length) {
                errors.push('No layer selected.');
            }
            return this.validationFailure(errors);
        }

        const target = resolveTargetLayerData(inputLayerId, context, { targetScope: params?.targetScope });
        if (!target.ok || !target.targetGeoJSON) {
            errors.push(target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
        }

        return this.validationFailure(errors);
    }

    async run(params, context = {}) {
        // Keep headless JSON receipts machine-readable; progress belongs on stderr.
        console.error("Exporting data...");
        const inputLayerId = params['Layer'];
        const formatKey = normalizeExportFormat(params['Format'] || 'GeoJSON');
        if (!formatKey) {
            this.setStatus(2, 'Unsupported export format.');
            return;
        }
        const formatMeta = SUPPORTED_EXPORT_FORMATS[formatKey];

        if (isAllLayersTarget(inputLayerId)) {
            const allLayers = resolveAllExportableLayers(context);
            if (!allLayers.length) {
                this.setStatus(2, 'No layer selected.');
                return;
            }

            const features = allLayers.flatMap((layer) => layer.features);
            let dataString = '';

            if (formatKey === 'geojson') {
                const layerSummaries = allLayers.map((layer) => ({
                    id: layer.id,
                    name: layer.name,
                    featureCount: layer.featureCount,
                    ...(layer.toolMetadata ? { toolMetadata: layer.toolMetadata } : {}),
                    ...(layer.toolHistory?.length ? { toolHistory: layer.toolHistory } : {}),
                }));
                const toolMetadata = {
                    name: this.name,
                    params,
                    parentLayerId: null,
                    exportedLayerIds: allLayers.map((layer) => layer.id),
                    target: {
                        mode: 'all-layers',
                        layerCount: allLayers.length,
                        selectedFeatureIds: [],
                        selectedFeatureCount: 0,
                        totalFeatureCount: features.length,
                    },
                    timestamp: new Date().toISOString(),
                };
                const exportedGeoJSON = {
                    type: 'FeatureCollection',
                    features,
                    layers: layerSummaries,
                    toolMetadata,
                    toolHistory: [toolMetadata],
                };
                dataString = JSON.stringify(exportedGeoJSON);
            } else if (formatKey === 'csv') {
                dataString = featuresToCsv(features);
            } else if (formatKey === 'wkt') {
                dataString = featuresToWktDocument(features);
            }

            this.setStatus(0, `Prepared ${formatMeta.label} export for ${allLayers.length} layer(s) (${features.length} feature(s)).`);
            return {
                download: {
                    filename: `all-layers.${formatMeta.extension}`,
                    mimeType: formatMeta.mimeType,
                    data: dataString,
                },
            };
        }

        const target = resolveTargetLayerData(inputLayerId, context, { targetScope: params?.targetScope });

        if (!target.ok || !target.targetGeoJSON) {
            this.setStatus(2, target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
            return;
        }

        const filenameSuffix = target.mode === 'selection' ? '-selection' : '';
        const features = extractFeaturesFromGeoJSON(target.targetGeoJSON);
        let dataString = '';

        if (formatKey === 'geojson') {
            const exportedGeoJSON = addExportMetadata(target.targetGeoJSON, target, params, this.name);
            dataString = JSON.stringify(exportedGeoJSON);
        } else if (formatKey === 'csv') {
            dataString = featuresToCsv(features);
        } else if (formatKey === 'wkt') {
            dataString = featuresToWktDocument(features);
        }

        this.setStatus(0, target.mode === 'selection'
            ? `Prepared ${formatMeta.label} export for ${target.selectedFeatureCount} selected feature(s).`
            : `Prepared ${formatMeta.label} export.`);
        return {
            download: {
                filename: `${target.layerId}${filenameSuffix}.${formatMeta.extension}`,
                mimeType: formatMeta.mimeType,
                data: dataString,
            },
        };
    }

    renderUI(paramValues = {}) {
        super.renderUI(paramValues);
        // update the polygon dropdown options based on tocLayers

        const inputLayer = document.getElementById('param-Layer');
        const knownLayers = listLayers();

        // Add an option for each known layer (stable ids)
        const preferredValue = paramValues['Layer'] || (typeof getActiveLayerId === 'function' ? getActiveLayerId() : null);
        if (inputLayer) {
            inputLayer.innerHTML = '';
            for (const l of knownLayers) {
                const option = document.createElement('option');
                option.value = l.id;
                option.text = l.label;
                if (l.id === preferredValue || (!preferredValue && inputLayer.childElementCount === 0)) option.selected = true;
                inputLayer.appendChild(option);
            }
            if (knownLayers.length > 0) {
                const allOption = document.createElement('option');
                allOption.value = EXPORT_ALL_LAYERS_VALUE;
                allOption.text = `All layers (${knownLayers.length})`;
                if (isAllLayersTarget(preferredValue)) allOption.selected = true;
                inputLayer.appendChild(allOption);
            }
        }
        
        // populate the format dropdown
        const formatID = document.getElementById('param-Format');
        if (formatID) {
            formatID.innerHTML = '';
            const options = ['GeoJSON', 'CSV', 'WKT'];
            const preferredFormat = normalizeExportFormat(paramValues['Format']) || 'geojson';

            for (let i = 0; i < options.length; i++) {
                const option = document.createElement('option');
                option.value = options[i];
                option.text = options[i];
                if (options[i].toLowerCase() === preferredFormat) {
                    option.selected = true;
                }
                formatID.appendChild(option);
            }
        }
    }
}

module.exports = {
    EXPORT_ALL_LAYERS_VALUE,
    SUPPORTED_EXPORT_FORMATS,
    ExportTool,
    addExportMetadata,
    featuresToCsv,
    featuresToWktDocument,
    geometryToWkt,
    isAllLayersTarget,
    normalizeExportFormat,
};
