const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const toolSpecs = require('./js/tools/specs.json');
const { requestStructuredData } = require('./js/ai/requestStructuredData');
const { runToolHeadlessly } = require('./js/runtime/headlessRunner');

function createApp() {
    const app = express();

    app.use(express.json());
    app.use(cors());

    // Serve static files from the "public" directory
    app.use(express.static(path.join(__dirname, 'public')));

    // Define a route for the root URL
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.get('/api/tools', (_req, res) => {
        res.json({ ok: true, tools: toolSpecs });
    });

    app.post('/api/run', async (req, res) => {
        try {
            const { tool, params, state } = req.body || {};
            const result = await runToolHeadlessly({
                toolKey: tool,
                params,
                state,
            });
            const statusCode = result && result.status ? result.status.code : 1;
            const hasResult = result && result.result !== undefined;
            if (statusCode !== 0 || !hasResult) {
                return res.status(400).json({
                    ok: false,
                    ...result,
                    error: (result && result.status && result.status.message) || 'Headless execution failed.',
                });
            }

            res.status(200).json({ ok: true, ...result });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                ok: false,
                error: error.message || 'Headless execution failed.',
            });
        }
    });

    app.post('/api/ai_structured', async (req, res) => {
        try {
            const {
                systemPrompt,
                userPrompt,
                model = 'gpt-4o',
                temperature = 0.2,
                maxTokens = 1200,
            } = req.body || {};
            const data = await requestStructuredData({
                systemPrompt,
                userPrompt,
                model,
                temperature,
                maxTokens,
            });
            res.status(200).json(data);
        } catch (error) {
            console.error('Error fetching structured AI data:', error);
            res.status(500).json({ error: 'Failed to connect to OpenAI' });
        }
    });

    app.post('/api/ai_geojson', async (req, res) => {
        const { prompt } = req.body;

        try {
            const geoJSON = await requestStructuredData({
                systemPrompt: "You are a helpful assistant that always only returns valid GeoJSON in response to user queries. Don't use too many vertices. Include somewhat detailed geometry and any attributes you think might be relevant. Include factual information. If you want to communicate text to the user, you may use a message property in the attributes of geometry objects. For compatibility with ArcGIS Pro, avoid multiple geometry types in the GeoJSON output. For example, don't mix points and polygons.",
                userPrompt: prompt,
                model: 'gpt-4o',
                temperature: 0.5,
                maxTokens: 1024,
            });
            res.status(200).json(geoJSON);
        } catch (error) {
            console.error('Error fetching from OpenAI:', error);
            res.status(500).json({ error: 'Failed to connect to OpenAI' });
        }
    });

    return app;
}

const app = createApp();

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = {
    app,
    createApp,
};
