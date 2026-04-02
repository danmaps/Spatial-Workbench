const { Tool } = require('../models/Tool');
const { Parameter } = require('../models/Parameter');
const { map } = require('../app');
const { applyResult } = require('../state');
let XLSX;
if (typeof window !== 'undefined' && window.XLSX) {
    XLSX = window.XLSX; // Browser environment (loaded from CDN)
} else {
    // This project uses the CDN build (see index.html) and webpack externals.
    // Avoid bundling the unmaintained npm package.
    XLSX = null;
}

class AddDataTool extends Tool {
    constructor() {
        super("Add Data", [
            new Parameter("Input", "data to add", "file", ""),
            new Parameter("Lat Column", "latitude column name", "dropdown", ""),
            new Parameter("Long Column", "longitude column name", "dropdown", ""),
            new Parameter("Override Columns", "manually specify columns", "boolean", false)
        ]);

        this.description = "Upload GeoJSON or tabular data (CSV/XLSX) with coordinates";
    }

    async run(params) {
        const file = params['Input'];
        if (!file) {
            throw new Error('Please select a file');
        }

        const fileType = file.name.split('.').pop().toLowerCase();

        if (fileType === 'geojson') {
            return await this.handleGeoJSON(file, params);
        } else if (fileType === 'csv' || fileType === 'xlsx') {
            return await this.handleTabular(file, fileType, params);
        } else {
            throw new Error('Unsupported file type. Please use .geojson, .csv, or .xlsx');
        }
    }

    handleGeoJSON(file, params) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const geojson = JSON.parse(e.target.result);
                    geojson.toolMetadata = {
                        name: this.name,
                        params: { ...params, Input: file.name },
                        timestamp: new Date().toISOString()
                    };
                    const res = this.addToMap(geojson);
                    this.setStatus(0, 'GeoJSON added to map.');
                    resolve(res);
                } catch (error) {
                    reject(new Error('Error loading GeoJSON file: ' + error.message));
                }
            };
            reader.readAsText(file);
        });
    }

    async handleTabular(file, fileType, params) {
        const data = await this.readTabularFile(file, fileType);
        if (!data || !data.length) {
            throw new Error('No data found in file');
        }

        const override = !!params['Override Columns'];
        let latCol = params['Lat Column'];
        let longCol = params['Long Column'];

        if (!override) {
            const headers = Object.keys(data[0]);
            latCol = headers.find(h => h.toLowerCase().includes('lat')) || '';
            longCol = headers.find(h => h.toLowerCase().includes('lon')) || '';
        }

        if (!latCol || !longCol) {
            throw new Error('Could not identify latitude/longitude columns');
        }

        const geojson = {
            type: 'FeatureCollection',
            features: data.map(row => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [parseFloat(row[longCol]), parseFloat(row[latCol])]
                },
                properties: row
            })).filter(f => !isNaN(f.geometry.coordinates[0]) && !isNaN(f.geometry.coordinates[1])),
            toolMetadata: {
                name: this.name,
                params: { ...params, Input: file.name, 'Lat Column': latCol, 'Long Column': longCol },
                timestamp: new Date().toISOString()
            }
        };

        const res = this.addToMap(geojson);
        this.setStatus(0, 'Tabular data added to map.');
        return res;
    }

    async readTabularFile(file, fileType) {
        if (fileType === 'csv') {
            const text = await file.text();
            return this.parseCSV(text);
        } else {
            if (!XLSX) {
                alert('XLSX parser not available. Reload the page and try again.');
                return [];
            }
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer);
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            return XLSX.utils.sheet_to_json(firstSheet);
        }
    }

    parseCSV(text) {
        // Simple CSV parsing - you might want to use a more robust CSV parser
        const lines = text.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        return lines.slice(1)
            .filter(line => line.trim())
            .map(line => {
                const values = line.split(',');
                return headers.reduce((obj, header, i) => {
                    obj[header] = values[i]?.trim() || '';
                    return obj;
                }, {});
            });
    }

    addToMap(geojson) {
        const res = applyResult({ addGeojson: geojson });
        // Fit bounds best-effort using a temporary layer
        try {
            const tmp = L.geoJSON(geojson);
            map.fitBounds(tmp.getBounds());
        } catch (_) {}
        return res;
    }

    renderUI() {
        super.renderUI();
        const inputElement = document.getElementById('param-Input');
        if (inputElement) {
            inputElement.accept = '.geojson,.csv,.xlsx';
        }

        // Hide column inputs initially
        const override = document.getElementById('param-Override Columns');
        const latCol = document.getElementById('param-Lat Column');
        const longCol = document.getElementById('param-Long Column');
        
        latCol.style.display = 'none';
        longCol.style.display = 'none';

        override.addEventListener('change', (e) => {
            latCol.style.display = e.target.checked ? 'block' : 'none';
            longCol.style.display = e.target.checked ? 'block' : 'none';
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AddDataTool };
} else {
    window.AddDataTool = AddDataTool;
}

