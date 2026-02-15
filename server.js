const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const app = express();
require('dotenv').config();

app.use(express.json());
app.use(cors());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Define a route for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const toolSpecs = require('./js/tools/specs.json');

app.get('/api/tools', (_req, res) => {
    res.json({ ok: true, tools: toolSpecs });
});

app.post('/api/ai_geojson', async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "You are a helpful assistant that always only returns valid GeoJSON in response to user queries. Don't use too many vertices. Include somewhat detailed geometry and any attributes you think might be relevant. Include factual information. If you want to communicate text to the user, you may use a message property in the attributes of geometry objects. For compatibility with ArcGIS Pro, avoid multiple geometry types in the GeoJSON output. For example, don't mix points and polygons." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 1024,
                temperature: 0.5,
                response_format: { "type": "json_object" }
            })
        });

        const data = await response.json();
        const geoJSON = JSON.parse(data.choices[0].message.content);
        res.status(200).json(geoJSON);
    } catch (error) {
        console.error('Error fetching from OpenAI:', error);
        res.status(500).json({ error: 'Failed to connect to OpenAI' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});