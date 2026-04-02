// https://stackoverflow.com/a/65320730
// https://jsfiddle.net/rp1320mf/
// https://turfjs.org/docs/#buffer

const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { map } = require('../app');
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
     * Executes the BufferTool logic without reading from the DOM.
     */
    async run(params) {
        const inputLayerId = params['Input Layer'];
        const distance = parseFloat(params['Distance']);
        const units = params['Units'];
    
        const layer = getLayer(inputLayerId);
        const selectedLayerGeoJSON = layer ? layer.toGeoJSON() : null;
    
        if (!selectedLayerGeoJSON) {
            this.setStatus(2, 'No layer selected.');
            return;
        }

        if (isNaN(distance)) {
            this.setStatus(2, 'No distance selected.');
            return;
        }
    
        const buffered = turf.buffer(selectedLayerGeoJSON, distance, {units: units});

        buffered.toolMetadata = {
            name: this.name,
            params,
            parentLayerId: inputLayerId,
            timestamp: new Date().toISOString()
        };

        const res = applyResult({ addGeojson: buffered });

        if (res && res.ok) {
            this.setStatus(0, 'Buffered layer added to map.');
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
