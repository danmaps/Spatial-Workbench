const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId } = require('../state');
const { buildTargetMetadata, buildToolHistory, getTargetToolHistory, resolveTargetLayerData } = require('./targeting');

const EXPORT_ALL_LAYERS_VALUE = '__all__';

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
            new Parameter("Format","format to export","dropdown","geojson", ["geojson"], null, null, true)  
        ]);

        this.description = "Export data";
        this.headlessSupported = true;
        this.execution = { stateMode: 'layers', inputs: [{ parameter: 'Layer', kind: 'layer', geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], cardinality: 'one', selectionAware: true }], outputs: [{ kind: 'artifact', operation: 'create', artifactType: 'download' }], mutatesState: false, producesArtifacts: true };
    }
    async validate(params, context = {}) {
        const inputLayerId = params['Layer'];
        const format = params['Format'] || 'GeoJSON';
        const errors = [];

        if (String(format).toLowerCase() !== 'geojson') {
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
        const format = params['Format'] || 'GeoJSON';
        if (String(format).toLowerCase() === 'geojson') {
            if (isAllLayersTarget(inputLayerId)) {
                const allLayers = resolveAllExportableLayers(context);
                if (!allLayers.length) {
                    this.setStatus(2, 'No layer selected.');
                    return;
                }

                const features = allLayers.flatMap((layer) => layer.features);
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
                this.setStatus(0, `Prepared GeoJSON export for ${allLayers.length} layer(s) (${features.length} feature(s)).`);
                return {
                    download: {
                        filename: `all-layers.${format.toLowerCase()}`,
                        mimeType: 'application/json',
                        data: JSON.stringify(exportedGeoJSON),
                    },
                };
            }

            const target = resolveTargetLayerData(inputLayerId, context, { targetScope: params?.targetScope });

            if (!target.ok || !target.targetGeoJSON) {
                this.setStatus(2, target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
                return;
            }

            const filenameSuffix = target.mode === 'selection' ? '-selection' : '';
            const exportedGeoJSON = addExportMetadata(target.targetGeoJSON, target, params, this.name);
            this.setStatus(0, target.mode === 'selection'
                ? `Prepared GeoJSON export for ${target.selectedFeatureCount} selected feature(s).`
                : 'Prepared GeoJSON export.');
            return {
                download: {
                    filename: `${target.layerId}${filenameSuffix}.${format.toLowerCase()}`,
                    mimeType: 'application/json',
                    data: JSON.stringify(exportedGeoJSON)
                }
            };
        }
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
            // create an array of options
            const options = ['GeoJSON']; // todo: KML, CSV, GeoPackage, Shapefile

            // loop through the options and create an option element for each one
            for (let i = 0; i < options.length; i++) {
                const option = document.createElement('option');
                option.value = options[i];
                option.text = options[i];
                formatID.appendChild(option);
            }

        }
    }


}

module.exports = {
    EXPORT_ALL_LAYERS_VALUE,
    ExportTool,
    addExportMetadata,
    isAllLayersTarget,
};
