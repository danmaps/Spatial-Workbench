const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { logCurrentBounds } = require('../utils/helpers');
const { drawnItems, map } = require('../app');
const { getLayer, listLayers, applyResult } = require('../state');

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
     * Executes the RandomPointsTool logic, adding specified number of random points within a selected polygon.
     */
    execute() {
        const pointsCountInput = document.getElementById('param-Points Count');
        const insidePolygonInput = document.getElementById('param-Inside Polygon');
        const polygonIdInput = document.getElementById('param-Polygon');
        
        const pointsCount = pointsCountInput ? parseInt(pointsCountInput.value, 10) : 0;
        const insidePolygon = insidePolygonInput.checked ? true : false;
        const polygonId = polygonIdInput ? polygonIdInput.value : null;
        
        if (insidePolygon) {
            const polygonLayer = polygonId ? getLayer(polygonId) : null;
            if (!polygonLayer || !(polygonLayer instanceof L.Polygon)) {
                this.setStatus(2, 'No polygon selected.');
                return;
            }

            const polygon = polygonLayer.toGeoJSON();
            const adds = [];

            for (let i = 0; i < pointsCount; i++) {
                let pointAdded = false;
                while (!pointAdded) {
                    const randomPoint = turf.randomPoint(1, { bbox: turf.bbox(polygon) });
                    if (turf.booleanPointInPolygon(randomPoint.features[0], polygon)) {
                        randomPoint.features[0].properties = randomPoint.features[0].properties || {};
                        randomPoint.features[0].properties.random = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);
                        randomPoint.features[0].toolMetadata = { name: this.name, parameters: this.parameters };
                        adds.push(randomPoint);
                        pointAdded = true;
                    }
                }
            }

            applyResult({ addGeojson: adds });
        } else {
            const visible_extent = logCurrentBounds(map);
            const randomPoints = turf.randomPoint(pointsCount, { bbox: visible_extent });
            randomPoints.features.forEach((pt) => {
                pt.properties = pt.properties || {};
                pt.toolMetadata = { name: this.name, parameters: this.parameters };
            });
            applyResult({ addGeojson: randomPoints });
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