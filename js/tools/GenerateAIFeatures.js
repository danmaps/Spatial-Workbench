const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { applyResult } = require('../state');
const { map } = require('../app');

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

    execute() {
        const prompt = document.getElementById('param-Prompt').value;
        const toolContent = document.getElementById('toolContent');
    
        // Use requestAnimationFrame to ensure the browser starts the animation before running the async function
        requestAnimationFrame(() => {
            (async () => {
                try {
                    toolContent.classList.add('pulsate');

                    // Make the API request
                    const response = await fetch('http://127.0.0.1:3000/api/ai_geojson', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ prompt: prompt })
                    });
                
                    const data = await response.json();
                    // console.log(data);
    
                    // Add the generated GeoJSON via centralized state
                    // NOTE: we still build a temporary layer here just for popup binding.
                    let layer = L.geoJSON(data);

                    layer.eachLayer(function (layer) {
                        let attributes = layer.feature.properties;
                        let popupContent = "<table class='popupTable'>";
                        for (let key in attributes) {
                            popupContent += `<tr><td><b>${key.charAt(0).toUpperCase() + key.slice(1)}</b></td><td>${attributes[key]}</td></tr>`;
                        }
                        popupContent += "</table>";
                        layer.bindPopup(popupContent);
                    });

                    applyResult({ addGeojson: data });
                } catch (error) {
                    console.error('Error during API call:', error);
                } finally {
                    // Stop the loading animation after the async task finishes
                    toolContent.classList.remove('pulsate');
                }
            })();
        });
    }
    
    
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GenerateAIFeatures };
} else {
    window.GenerateAIFeatures = GenerateAIFeatures;
}