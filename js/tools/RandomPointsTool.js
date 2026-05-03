const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { logCurrentBounds } = require('../utils/helpers');
const { getLayer, listLayers, applyResult } = require('../state');

function getExecutionBoundsSource(context) {
    if (context && context.map) {
        return context.map;
    }

    if (context && context.state && context.state.bounds) {
        return context.state.bounds;
    }

    try {
        return require('../app').map || null;
    } catch (_) {
        return null;
    }
}

function buildRandomPointsResult(toolName, params, features, parentLayerId = null) {
    return {
        type: 'FeatureCollection',
        features,
        toolMetadata: {
            name: toolName,
            params,
            ...(parentLayerId ? { parentLayerId } : {}),
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Represents a tool for adding random points within selected polygon.
 * @extends Tool
 */
class RandomPointsTool extends Tool {
    /**
     * Constructs an instance of RandomPointsTool.
     */
    constructor() {    
        super("Random Points", [
            new Parameter("Points Count", "Number of random points to generate.", "int", 10),
            new Parameter("Inside Polygon",  "Generate points inside polygon", "boolean", false),
            new Parameter("Polygon",  "Polygon to add random points within.", "dropdown", "")
        ]);

        this.description = 'Adds random points within selected polygon';
    }

    /**
     * Executes the RandomPointsTool logic without reading from the DOM.
     */
    async run(params, context) {
        const pointsCount = parseInt(params['Points Count'], 10);
        if (!Number.isInteger(pointsCount) || pointsCount <= 0) {
            this.setStatus(2, 'Points Count must be a positive integer.');
            return;
        }

        const insidePolygon = !!params['Inside Polygon'];
        const polygonId = params['Polygon'] || null;
        
        if (insidePolygon) {
            const polygonLayer = polygonId ? getLayer(polygonId) : null;
            if (!polygonLayer) {
                this.setStatus(2, 'No polygon selected.');
                return;
            } else if (!(polygonLayer instanceof L.Polygon)) {
                this.setStatus(2, 'Selected layer is not a polygon.');
                return;
            }

            const polygon = polygonLayer.toGeoJSON();
            const features = [];

            for (let i = 0; i < pointsCount; i++) {
                let pointAdded = false;
                while (!pointAdded) {
                    const randomPoint = turf.randomPoint(1, { bbox: turf.bbox(polygon) });
                    if (turf.booleanPointInPolygon(randomPoint.features[0], polygon)) {
                        const feature = randomPoint.features[0];
                        feature.properties = feature.properties || {};
                        feature.properties.random = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);
                        features.push(feature);
                        pointAdded = true;
                    }
                }
            }

            const featureCollection = buildRandomPointsResult(this.name, params, features, polygonId);

            const res = applyResult({ addGeojson: featureCollection });
            if (res && res.ok) {
                this.setStatus(0, `Added ${features.length} point(s).`);
                return res;
            } else {
                this.setStatus(2, 'Failed to add points to map.');
            }
        } else {
            const boundsSource = getExecutionBoundsSource(context);
            if (!boundsSource) {
                this.setStatus(3, 'Map bounds are unavailable.');
                return;
            }

            const visible_extent = logCurrentBounds(boundsSource);
            const randomPoints = turf.randomPoint(pointsCount, { bbox: visible_extent });
            const features = Array.isArray(randomPoints?.features) ? randomPoints.features : [];
            features.forEach((pt) => {
                pt.properties = pt.properties || {};
            });
            const featureCollection = buildRandomPointsResult(this.name, params, features);
            const res = applyResult({ addGeojson: featureCollection });
            if (res && res.ok) {
                this.setStatus(0, `Added ${features.length} point(s).`);
                return res;
            } else {
                this.setStatus(2, 'Failed to add points to map.');
            }
        }
    }

    // Dynamically populate dropdown when the tool is selected
    renderUI() {
        super.renderUI(); // Ensure any base UI rendering logic is called

        // Dynamically update the polygon dropdown options based on drawnItems
        const polygonIdInput = document.getElementById('param-Polygon');
        if (polygonIdInput) {
            // Clear existing options
            polygonIdInput.innerHTML = '';

            // Populate dropdown with current polygons (stable ids)
            const layers = listLayers().filter((l) => l.geometryType === 'Polygon' || l.geometryType === 'MultiPolygon');
            for (const l of layers) {
                const option = document.createElement('option');
                option.value = l.id;
                option.text = l.label;
                polygonIdInput.appendChild(option);
            }
        }
    }
    
}
// Utility function to generate a random string of 5 characters
function generateRandomString() {
    return Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RandomPointsTool };
} else {
    window.RandomPointsTool = RandomPointsTool;
}
