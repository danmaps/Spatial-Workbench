const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { getLayer, listLayers } = require('../state');

class GroupTool extends Tool {
    constructor() {
        super("Group", [
            new Parameter("Layer","layer to group","dropdown",""),
            new Parameter("Distance","distance threshold","float",10),
            new Parameter("Units","The units for the distance", "dropdown","miles", ["feet","miles","kilometers","degrees"])    
        ]);

        this.description = "Group";
    }
    execute() {
        super.execute();
        console.log("Exporting data...");
        const inputLayerId = document.getElementById('param-Layer').value;
        const distance = document.getElementById('param-Distance').value;
        const units = document.getElementById('param-Units').value;

        const inputLayer = getLayer(inputLayerId);

        if (inputLayer) {
            const geojson = inputLayer.toGeoJSON();
            const features = geojson.features;
            const groupedFeatures = this.groupFeatures(features, distance, units);
            const groupedGeojson = { type: 'FeatureCollection', features: groupedFeatures };    
            const geojsonString = JSON.stringify(groupedGeojson);
            const blob = new Blob([geojsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'grouped.geojson';
            link.click();
            URL.revokeObjectURL(url);
        }
    }

    renderUI() {
        super.renderUI(); 
        const inputLayer = document.getElementById('param-Layer');
        const distance = parseFloat(document.getElementById('param-Distance').value);

        // Add an option for each known layer (stable ids)
        for (const l of listLayers()) {
            const option = document.createElement('option');
            option.value = l.id;
            option.text = l.label;
            inputLayer.appendChild(option);
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

module.exports = { GroupTool };

