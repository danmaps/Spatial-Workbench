const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult, getLayer } = require('../state');

/**
 * A tool tool for generating AI features.
 * Calls an API associated with an AI to interpret the user prompt.
 * Draws the features on the map.
 * 
 * Infers layer name, description, and fields from the prompt.
 * 
 * 
 */

class GenerateAIFeatures extends Tool {

    constructor() {    
        super("Generate AI Features", [
            new Parameter("Prompt","The prompt to generate AI features","text","")  
        ]);
    }

    async run(params) {
        const prompt = params['Prompt'];

        const response = await fetch('http://127.0.0.1:3000/api/ai_geojson', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        });
    
        if (!response.ok) {
            throw new Error(`AI request failed with status ${response.status}`);
        }

        const data = await response.json();
        data.toolMetadata = {
            name: this.name,
            params,
            timestamp: new Date().toISOString()
        };

        const res = applyResult({ addGeojson: data });

        if (res && res.ok) {
            for (const id of (res.added || [])) {
                const addedLayer = getLayer(id);
                if (!addedLayer || !addedLayer.feature || !addedLayer.feature.properties) continue;

                const attributes = addedLayer.feature.properties;
                let popupContent = "<table class='popupTable'>";
                for (let key in attributes) {
                    popupContent += `<tr><td><b>${key.charAt(0).toUpperCase() + key.slice(1)}</b></td><td>${attributes[key]}</td></tr>`;
                }
                popupContent += "</table>";
                if (typeof addedLayer.bindPopup === 'function') {
                    addedLayer.bindPopup(popupContent);
                }
            }
            this.setStatus(0, 'AI features added to map.');
            return res;
        }

        this.setStatus(2, 'Failed to add AI features to map.');
    }
    
    
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GenerateAIFeatures };
} else {
    window.GenerateAIFeatures = GenerateAIFeatures;
}