const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');

function cloneFeature(feature) {
    return feature == null ? feature : JSON.parse(JSON.stringify(feature));
}

function getFeatureCollection(geojson) {
    if (!geojson || typeof geojson !== 'object') return [];
    if (geojson.type === 'FeatureCollection') return Array.isArray(geojson.features) ? geojson.features : [];
    if (geojson.type === 'Feature') return [geojson];
    return [];
}

function getFeatureIdentifier(feature, fallbackId) {
    if (!feature || feature.type !== 'Feature') return fallbackId;
    if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
    const stableId = feature.properties.__id || feature.id || fallbackId;
    if (stableId) {
        feature.properties.__id = stableId;
        if (feature.id === undefined || feature.id === null || feature.id === '') feature.id = stableId;
    }
    return stableId;
}

function buildGroupingSummary(features) {
    const counts = new Map();
    let ungroupedCount = 0;

    features.forEach((feature) => {
        const clusterId = feature?.properties?.groupId;
        if (clusterId === null || clusterId === undefined || clusterId === '') {
            ungroupedCount += 1;
            return;
        }
        counts.set(clusterId, (counts.get(clusterId) || 0) + 1);
    });

    return {
        groupCount: counts.size,
        ungroupedCount,
        groups: Array.from(counts.entries())
            .map(([groupId, featureCount]) => ({ groupId, featureCount }))
            .sort((a, b) => String(a.groupId).localeCompare(String(b.groupId))),
    };
}

class GroupTool extends Tool {
    constructor() {
        super('Group', [
            new Parameter('Layer', 'layer to group', 'dropdown', ''),
            new Parameter('Distance', 'distance threshold', 'float', 10, null, 0),
            new Parameter('Units', 'The units for the distance', 'dropdown', 'kilometers', ['feet', 'miles', 'kilometers', 'degrees']),
        ]);

        this.description = 'Groups nearby features by distance and adds the grouped result as a new layer';
    }

    async run(params, context = {}) {
        const inputLayerId = params.Layer;
        const distance = parseFloat(params.Distance);
        const units = params.Units || 'kilometers';
        const applyToolResult = context.applyResult || applyResult;
        const target = resolveTargetLayerData(inputLayerId, context);

        if (!target.ok || !target.targetGeoJSON) {
            this.setStatus(2, target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
            return;
        }

        if (!Number.isFinite(distance) || distance <= 0) {
            this.setStatus(2, 'Distance must be greater than 0.');
            return;
        }

        const turfLib = globalThis.turf;
        if (!turfLib || typeof turfLib.clustersDbscan !== 'function' || typeof turfLib.centroid !== 'function') {
            this.setStatus(7, 'Grouping dependencies are unavailable.');
            return;
        }

        const sourceFeatures = getFeatureCollection(target.targetGeoJSON).map((feature, index) => {
            const cloned = cloneFeature(feature);
            getFeatureIdentifier(cloned, `${target.layerId || 'feature'}-${index + 1}`);
            return cloned;
        });

        if (!sourceFeatures.length) {
            this.setStatus(2, 'No features available to group.');
            return;
        }

        const centroidFeatures = sourceFeatures.map((feature, index) => {
            if (feature?.geometry?.type === 'Point') {
                return {
                    type: 'Feature',
                    geometry: cloneFeature(feature.geometry),
                    properties: {
                        __sourceFeatureId: getFeatureIdentifier(feature, `${target.layerId || 'feature'}-${index + 1}`),
                    },
                };
            }

            const centroid = turfLib.centroid(feature);
            centroid.properties = {
                ...(centroid.properties || {}),
                __sourceFeatureId: getFeatureIdentifier(feature, `${target.layerId || 'feature'}-${index + 1}`),
            };
            return centroid;
        });

        const clustered = turfLib.clustersDbscan({
            type: 'FeatureCollection',
            features: centroidFeatures,
        }, distance, { units });

        const groupedFeatures = sourceFeatures.map((feature, index) => {
            const clusteredFeature = clustered?.features?.[index] || null;
            const groupId = clusteredFeature?.properties?.cluster;
            const dbscan = clusteredFeature?.properties?.dbscan || (groupId === undefined ? 'noise' : 'core');
            const grouped = cloneFeature(feature);
            grouped.properties = {
                ...(grouped.properties || {}),
                grouped: groupId !== undefined,
                groupId: groupId !== undefined ? `group-${groupId}` : null,
                groupStatus: groupId !== undefined ? 'grouped' : 'ungrouped',
                groupDbscanRole: dbscan,
                groupDistance: distance,
                groupUnits: units,
            };
            return grouped;
        });

        const summary = buildGroupingSummary(groupedFeatures);
        groupedFeatures.forEach((feature) => {
            const currentGroupId = feature?.properties?.groupId;
            if (!currentGroupId) {
                feature.properties.groupSize = 1;
                return;
            }
            const groupSummary = summary.groups.find((group) => group.groupId === currentGroupId);
            feature.properties.groupSize = groupSummary ? groupSummary.featureCount : 1;
        });

        const groupedGeojson = {
            type: 'FeatureCollection',
            features: groupedFeatures,
            toolMetadata: {
                name: this.name,
                params: {
                    ...params,
                    Layer: target.layerId,
                    Distance: distance,
                    Units: units,
                },
                parentLayerId: target.layerId,
                target: {
                    mode: target.mode,
                    selectedFeatureIds: target.selectedFeatureIds,
                    selectedFeatureCount: target.selectedFeatureCount,
                    totalFeatureCount: target.totalFeatureCount,
                },
                result: summary,
                timestamp: new Date().toISOString(),
            },
        };

        const res = applyToolResult({ addGeojson: groupedGeojson });
        if (res && res.ok) {
            const featureScope = target.mode === 'selection' ? `${target.selectedFeatureCount} selected feature(s)` : `${sourceFeatures.length} feature(s)`;
            const groupSummaryLabel = summary.groupCount
                ? `${summary.groupCount} group(s)`
                : 'no multi-feature groups';
            const ungroupedLabel = summary.ungroupedCount ? `, ${summary.ungroupedCount} ungrouped` : '';
            this.setStatus(0, `Grouped ${featureScope} into ${groupSummaryLabel}${ungroupedLabel}.`);
            return res;
        }

        this.setStatus(2, 'Failed to add grouped layer to map.');
    }

    renderUI() {
        super.renderUI();

        const inputLayer = document.getElementById('param-Layer');
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

        const unitsParameter = this.parameters.find((parameter) => parameter.name === 'Units');
        if (unitsParameter?.options) {
            const unitsInput = document.getElementById('param-Units');
            if (unitsInput) {
                unitsInput.innerHTML = '';
                unitsParameter.options.forEach((unit) => {
                    const option = document.createElement('option');
                    option.value = unit;
                    option.text = unit.charAt(0).toUpperCase() + unit.slice(1);
                    if (unit === unitsParameter.defaultValue) option.selected = true;
                    unitsInput.appendChild(option);
                });
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GroupTool };
} else {
    window.GroupTool = GroupTool;
}
