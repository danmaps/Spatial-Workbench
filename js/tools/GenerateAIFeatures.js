const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult, getLayer } = require('../state');
const { requestStructuredData } = require('../ai/requestStructuredData');

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
        const data = await requestStructuredData({
            systemPrompt: "You are a helpful assistant that always only returns valid GeoJSON in response to user queries. Don't use too many vertices. Include somewhat detailed geometry and any attributes you think might be relevant. Include factual information. If you want to communicate text to the user, you may use a message property in the attributes of geometry objects. For compatibility with ArcGIS Pro, avoid multiple geometry types in the GeoJSON output. For example, don't mix points and polygons.",
            userPrompt: prompt,
            model: 'gpt-4o',
            temperature: 0.5,
            maxTokens: 1024,
        });
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
