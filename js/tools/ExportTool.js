const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { listLayers } = require('../state');
const { resolveTargetLayerData } = require('./targeting');

class ExportTool extends Tool {
    constructor() {
        super("Export", [
            new Parameter("Layer","layer to export","dropdown",""),
            new Parameter("Format","format to export","dropdown","geojson")  
        ]);

        this.description = "Export data";
    }
    async run(params, context = {}) {
        console.log("Exporting data...");
        const inputLayerId = params['Layer'];
        const format = params['Format'];
        if (format === 'GeoJSON') {
            const target = resolveTargetLayerData(inputLayerId, context);

            if (!target.ok || !target.targetGeoJSON) {
                this.setStatus(2, target.mode === 'selection-empty' ? 'No selected features in the chosen layer.' : 'No layer selected.');
                return;
            }

            const filenameSuffix = target.mode === 'selection' ? '-selection' : '';
            this.setStatus(0, target.mode === 'selection'
                ? `Prepared GeoJSON export for ${target.selectedFeatureCount} selected feature(s).`
                : 'Prepared GeoJSON export.');
            return {
                download: {
                    filename: `${target.layerId}${filenameSuffix}.${format.toLowerCase()}`,
                    mimeType: 'application/json',
                    data: JSON.stringify(target.targetGeoJSON)
                }
            };
        }
    }

    renderUI() {
        super.renderUI(); 
        // update the polygon dropdown options based on tocLayers

        const inputLayer = document.getElementById('param-Layer');

        // Add an option for each known layer (stable ids)
        for (const l of listLayers()) {
            const option = document.createElement('option');
            option.value = l.id;
            option.text = l.label;
            inputLayer.appendChild(option);
        }
        
        // populate the format dropdown
        const formatID = document.getElementById('param-Format');
        if (formatID) {
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

module.exports = { ExportTool };

