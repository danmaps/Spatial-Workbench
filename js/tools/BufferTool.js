// https://stackoverflow.com/a/65320730
// https://jsfiddle.net/rp1320mf/
// https://turfjs.org/docs/#buffer

const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { tocLayers, map } = require('../app');
const { getLayer, listLayers, applyResult } = require('../state');

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
     * Executes the BufferTool logic.
     */
    execute() {
        super.execute();

        // Retrieve the selected input layer's ID from the dropdown
        const inputLayerId = document.getElementById('param-Input Layer').value;
        // Retrieve the buffer distance
        const distance = parseFloat(document.getElementById('param-Distance').value);
        // Retrieve the selected units from the dropdown
        const units = document.getElementById('param-Units').value;
    
        const layer = getLayer(inputLayerId);
        const selectedLayerGeoJSON = layer ? layer.toGeoJSON() : null;
    
        // Ensure a layer was selected and convert to GeoJSON was successful
        if (!selectedLayerGeoJSON) {
            this.setStatus(2, 'No layer selected.');
            return;
        }

        // if no distance is selected, return
        if (isNaN(distance)) {
            this.setStatus(2, 'No distance selected.');
            return;
        }
    
        // Use Turf.js to buffer the selected layer
        const buffered = turf.buffer(selectedLayerGeoJSON, distance, {units: units});

        // Add metadata to the layer with tool name and parameters
        buffered.toolMetadata = {
            name: this.name,
            parameters: this.parameters
        };

        // Apply via centralized state (no direct map mutation here)
        applyResult({ addGeojson: buffered });

        this.setStatus(0, 'Buffered layer added to map.');
    }
    
    renderUI() {
        super.renderUI(); 

        // update the polygon dropdown options based on tocLayers
        const inputLayer = document.getElementById('param-Input Layer');
        if (inputLayer) {
            inputLayer.innerHTML = ''; // Clear existing options

            // Add an option for each known layer (stable ids)
            const layers = listLayers();
            for (const l of layers) {
                const option = document.createElement('option');
                option.value = l.id;
                option.text = l.label;
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
