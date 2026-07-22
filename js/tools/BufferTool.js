// https://stackoverflow.com/a/65320730
// https://jsfiddle.net/rp1320mf/
// https://turfjs.org/docs/#buffer

const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers, getActiveLayerId, applyResult } = require('../state');
const { resolveTargetLayerData } = require('./targeting');

/**
 * Represents a tool for adding a buffer to the selected layer.
 * @extends Tool
 */
class BufferTool extends Tool {
    /**
     * Constructs an instance of BufferTool.
     */
    constructor() {    
        super("Buffer", [
            new Parameter("Input Layer","The input layer to buffer","dropdown",""),
            new Parameter("Distance", "The distance", "float", 10),
            new Parameter("Units","The units for the distance", "dropdown","miles", ["feet","miles","kilometers","degrees"])    
        ]);

        this.description = 'Makes a buffer around the input layer';
    }

    /**
     * Executes the BufferTool logic without reading from the DOM.
     */
    async validate(params, context = {}) {
        const inputLayerId = params['Input Layer'];
        const distance = parseFloat(params['Distance']);
        const target = resolveTargetLayerData(inputLayerId, context);
        const errors = [];

        if (!target.ok || !target.targetGeoJSON) {
            errors.push(target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
        }

        if (!Number.isFinite(distance)) {
            errors.push('No distance selected.');
        }

        return this.validationFailure(errors);
    }

    async run(params, context = {}) {
        const inputLayerId = params['Input Layer'];
        const distance = parseFloat(params['Distance']);
        const applyToolResult = context.applyResult || applyResult;
        const spatial = context.spatial || null;
        const target = resolveTargetLayerData(inputLayerId, context);
    
        if (!target.ok || !target.targetGeoJSON) {
            this.setStatus(2, target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
            return;
        }

        if (isNaN(distance)) {
            this.setStatus(2, 'No distance selected.');
            return;
        }
    
        const targetFeatures = target.targetGeoJSON?.type === 'FeatureCollection'
            ? target.targetGeoJSON.features || []
            : [target.targetGeoJSON];
        const bufferedFeatures = [];
        let skippedFeatureCount = 0;
        const hasNullGeometry = targetFeatures.some((feature) => !feature?.geometry);

        if (!hasNullGeometry) {
            try {
                const bufferedGeojson = turf.buffer(target.targetGeoJSON, distance, { units: params['Units'] });
                if (bufferedGeojson) {
                    bufferedGeojson.toolMetadata = {
                        name: this.name,
                        params: {
                            ...params,
                            'Input Layer': target.layerId,
                        },
                        parentLayerId: target.layerId,
                        target: {
                            mode: target.mode,
                            selectedFeatureIds: target.selectedFeatureIds,
                            selectedFeatureCount: target.selectedFeatureCount,
                            totalFeatureCount: target.totalFeatureCount,
                        },
                        timestamp: new Date().toISOString()
                    };

                    const res = applyToolResult({ addGeojson: bufferedGeojson });
                    if (res && res.ok) {
                        this.setStatus(0, target.mode === 'selection'
                            ? `Buffered ${target.selectedFeatureCount} selected feature(s).`
                            : 'Buffered layer added to map.');
                        return res;
                    }
                }
            } catch (_error) {
                // Fall back to per-feature buffering so invalid members can be reported and skipped.
            }
        }

        targetFeatures.forEach((feature) => {
            if (!feature?.geometry) {
                skippedFeatureCount += 1;
                return;
            }

            try {
                const bufferedFeature = turf.buffer(feature, distance, { units: params['Units'] });
                if (bufferedFeature?.type === 'Feature') {
                    bufferedFeatures.push(bufferedFeature);
                } else if (bufferedFeature?.type === 'FeatureCollection' && Array.isArray(bufferedFeature.features)) {
                    bufferedFeatures.push(...bufferedFeature.features);
                } else {
                    skippedFeatureCount += 1;
                }
            } catch (_error) {
                skippedFeatureCount += 1;
            }
        });

        if (!bufferedFeatures.length) {
            spatial?.addWarning({
                code: 'buffer-empty-output',
                message: 'Buffer produced no valid output features.',
                layerId: target.layerId,
                details: {
                    inputFeatureCount: targetFeatures.length,
                    skippedFeatureCount,
                },
            });
            this.setStatus(2, 'Buffer produced no valid output.');
            return;
        }

        if (skippedFeatureCount > 0) {
            spatial?.addWarning({
                code: 'buffer-skipped-features',
                message: `Buffer skipped ${skippedFeatureCount} invalid or empty feature(s).`,
                layerId: target.layerId,
                details: {
                    inputFeatureCount: targetFeatures.length,
                    outputFeatureCount: bufferedFeatures.length,
                    skippedFeatureCount,
                },
            });
        }

        const buffered = target.targetGeoJSON?.type === 'FeatureCollection'
            ? {
                type: 'FeatureCollection',
                features: bufferedFeatures,
            }
            : (bufferedFeatures[0] || null);

        if (!buffered) {
            spatial?.addWarning({
                code: 'buffer-empty-output',
                message: 'Buffer produced no valid output features.',
                layerId: target.layerId,
                details: {
                    inputFeatureCount: targetFeatures.length,
                    skippedFeatureCount,
                },
            });
            this.setStatus(2, 'Buffer produced no valid output.');
            return;
        }
        buffered.toolMetadata = {
            name: this.name,
            params: {
                ...params,
                'Input Layer': target.layerId,
            },
            parentLayerId: target.layerId,
            target: {
                mode: target.mode,
                selectedFeatureIds: target.selectedFeatureIds,
                selectedFeatureCount: target.selectedFeatureCount,
                totalFeatureCount: target.totalFeatureCount,
            },
            timestamp: new Date().toISOString()
        };

        const res = applyToolResult({ addGeojson: buffered });

        if (res && res.ok) {
            if (skippedFeatureCount > 0) {
                this.setStatus(0, `Buffered ${bufferedFeatures.length} feature(s); skipped ${skippedFeatureCount} invalid or empty feature(s).`);
            } else {
                this.setStatus(0, target.mode === 'selection'
                    ? `Buffered ${target.selectedFeatureCount} selected feature(s).`
                    : 'Buffered layer added to map.');
            }
            return res;
        } else {
            this.setStatus(2, 'Failed to add buffered layer to map.');
        }
    }
    
    renderUI() {
        super.renderUI(); 

        // update the polygon dropdown options based on tocLayers
        const inputLayer = document.getElementById('param-Input Layer');
        if (inputLayer) {
            inputLayer.innerHTML = ''; // Clear existing options

            // Add an option for each known layer (stable ids)
            const layers = listLayers();
            const activeLayerId = typeof getActiveLayerId === 'function' ? getActiveLayerId() : null;
            for (const l of layers) {
                const option = document.createElement('option');
                option.value = l.id;
                option.text = l.label;
                if (l.id === activeLayerId || (!activeLayerId && inputLayer.childElementCount === 0)) option.selected = true;
                inputLayer.appendChild(option);
            }

        }

        // Populate the "Units" dropdown using the information from the Parameter object
        const unitsParameter = this.parameters.find(p => p.name === "Units");
        if (unitsParameter && unitsParameter.options) {
            const unitsInput = document.getElementById('param-Units');
            // Populate dropdown with units options from the Parameter object
            unitsParameter.options.forEach(unit => {
                const option = document.createElement('option');
                option.value = unit;
                option.text = unit.charAt(0).toUpperCase() + unit.slice(1); // Capitalize the first letter
                if (unit === unitsParameter.defaultValue) {
                    option.selected = true; // Set the default value as selected
                }
                unitsInput.appendChild(option);
            });
            
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BufferTool };
} else {
    window.BufferTool = BufferTool;
}
