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

const BUNDLED_SAMPLE_DATASETS = [
    {
        id: 'sample-cities',
        fileName: 'sample-cities.geojson',
        label: 'Sample Cities',
        data: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'Los Angeles', kind: 'city', population: 3898747 },
                    geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
                },
                {
                    type: 'Feature',
                    properties: { name: 'San Diego', kind: 'city', population: 1386932 },
                    geometry: { type: 'Point', coordinates: [-117.1611, 32.7157] },
                },
                {
                    type: 'Feature',
                    properties: { name: 'Las Vegas', kind: 'city', population: 641903 },
                    geometry: { type: 'Point', coordinates: [-115.1398, 36.1699] },
                },
            ],
        },
    },
    {
        id: 'sample-study-area',
        fileName: 'sample-study-area.geojson',
        label: 'Sample Study Area',
        data: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'Southern California Study Area', kind: 'study-area' },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [-119.3, 33.2],
                            [-116.0, 33.2],
                            [-116.0, 35.2],
                            [-119.3, 35.2],
                            [-119.3, 33.2],
                        ]],
                    },
                },
            ],
        },
    },
];

class AddDataTool extends Tool {
    constructor() {
        super("Add Data", [
            new Parameter("Input", "data to add", "file", "", null, null, null, true),
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

    buildImportSummary({ fileName, fileType, importedCount, skippedCount = 0, detectedColumns = {}, warnings = [] }) {
        return {
            fileName,
            fileType,
            importedCount,
            skippedCount,
            detectedColumns,
            warnings,
        };
    }

    attachImportSummary(geojson, summary) {
        if (!summary) return geojson;
        const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
        const enrichFeature = (feature) => {
            feature.properties = feature.properties || {};
            feature.properties.importSummary = summary;
            if (warnings.length) feature.properties.importWarnings = warnings;
            return feature;
        };

        if (geojson.type === 'FeatureCollection') {
            geojson.features = (geojson.features || []).map(enrichFeature);
        } else if (geojson.type === 'Feature') {
            enrichFeature(geojson);
        }

        return geojson;
    }

    createSampleDataset(dataset) {
        const featureCount = dataset.data.type === 'FeatureCollection'
            ? (dataset.data.features || []).length
            : 1;
        const geojson = JSON.parse(JSON.stringify(dataset.data));
        const importSummary = this.buildImportSummary({
            fileName: dataset.fileName,
            fileType: 'geojson',
            importedCount: featureCount,
            skippedCount: 0,
            warnings: [],
        });

        geojson.toolMetadata = {
            name: this.name,
            params: { Input: dataset.label, Source: 'Bundled Sample Data' },
            timestamp: new Date().toISOString(),
        };

        this.attachImportSummary(geojson, importSummary);
        return geojson;
    }

    async loadSampleData() {
        const sampleLayers = BUNDLED_SAMPLE_DATASETS.map((dataset) => this.createSampleDataset(dataset));
        const res = this.addToMap(sampleLayers);
        const featureCount = sampleLayers.reduce((total, layer) => total + ((layer.features || []).length || 0), 0);
        this.setStatus(0, `Loaded ${sampleLayers.length} sample layer(s) with ${featureCount} feature(s).`);
        return {
            ...res,
            sampleData: {
                layerCount: sampleLayers.length,
                featureCount,
                datasets: BUNDLED_SAMPLE_DATASETS.map(({ id, label, fileName }) => ({ id, label, fileName })),
            },
        };
    }

    handleGeoJSON(file, params) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const geojson = JSON.parse(e.target.result);
                    const isAllLayersBundle = geojson?.type === 'FeatureCollection'
                        && Array.isArray(geojson.layers)
                        && geojson.layers.length > 0
                        && Array.isArray(geojson.features)
                        && geojson.features.some((feature) => feature?.properties?.__layerId);

                    if (isAllLayersBundle) {
                        const restoredLayers = geojson.layers
                            .map((layerSummary) => {
                                const layerFeatures = geojson.features
                                    .filter((feature) => feature?.properties?.__layerId === layerSummary.id);
                                if (!layerFeatures.length) return null;
                                const collection = {
                                    type: 'FeatureCollection',
                                    features: layerFeatures,
                                    properties: {
                                        ...(layerSummary.name ? { name: layerSummary.name, displayName: layerSummary.name } : {}),
                                    },
                                    ...(layerSummary.symbology ? { symbology: layerSummary.symbology } : {}),
                                    ...(Array.isArray(layerSummary.toolHistory) ? { toolHistory: layerSummary.toolHistory } : {}),
                                    toolMetadata: {
                                        name: this.name,
                                        params: { ...params, Input: file.name, RestoredLayer: layerSummary.name || layerSummary.id },
                                        timestamp: new Date().toISOString(),
                                    },
                                };
                                const importSummary = this.buildImportSummary({
                                    fileName: file.name,
                                    fileType: 'geojson',
                                    importedCount: layerFeatures.length,
                                    skippedCount: 0,
                                    warnings: [],
                                });
                                this.attachImportSummary(collection, importSummary);
                                return collection;
                            })
                            .filter(Boolean);

                        if (restoredLayers.length) {
                            const totalImported = restoredLayers.reduce((sum, layer) => sum + layer.features.length, 0);
                            const res = this.addToMap(restoredLayers);
                            const importSummary = this.buildImportSummary({
                                fileName: file.name,
                                fileType: 'geojson',
                                importedCount: totalImported,
                                skippedCount: 0,
                                warnings: [],
                            });
                            this.setStatus(0, `Imported ${restoredLayers.length} layer(s) (${totalImported} feature(s)) from ${file.name}.`);
                            resolve({ ...res, importSummary });
                            return;
                        }
                    }

                    const featureCount = geojson.type === 'FeatureCollection'
                        ? (geojson.features || []).length
                        : 1;
                    const importSummary = this.buildImportSummary({
                        fileName: file.name,
                        fileType: 'geojson',
                        importedCount: featureCount,
                        skippedCount: 0,
                        warnings: [],
                    });
                    geojson.toolMetadata = {
                        name: this.name,
                        params: { ...params, Input: file.name },
                        timestamp: new Date().toISOString()
                    };
                    this.attachImportSummary(geojson, importSummary);
                    const res = this.addToMap(geojson);
                    this.setStatus(0, `Imported ${featureCount} GeoJSON feature(s).`);
                    resolve({ ...res, importSummary });
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
            longCol = headers.find(h => {
                const lowered = h.toLowerCase();
                return lowered.includes('lon') || lowered.includes('lng') || lowered.includes('long');
            }) || '';
        }

        if (!latCol || !longCol) {
            throw new Error('Could not identify latitude/longitude columns');
        }

        const warnings = [];
        const skippedSamples = [];
        const features = [];

        data.forEach((row, index) => {
            const latRaw = row[latCol];
            const lonRaw = row[longCol];
            const lat = parseFloat(latRaw);
            const lon = parseFloat(lonRaw);

            if (Number.isNaN(lat) || Number.isNaN(lon)) {
                skippedSamples.push(`Row ${index + 2} skipped: invalid coordinates (${latRaw}, ${lonRaw})`);
                return;
            }

            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lon, lat]
                },
                properties: row
            });
        });

        if (skippedSamples.length) {
            warnings.push(...skippedSamples.slice(0, 5));
            if (skippedSamples.length > 5) {
                warnings.push(`${skippedSamples.length - 5} more row(s) were skipped for invalid coordinates.`);
            }
        }

        const importSummary = this.buildImportSummary({
            fileName: file.name,
            fileType,
            importedCount: features.length,
            skippedCount: data.length - features.length,
            detectedColumns: { lat: latCol, lon: longCol },
            warnings,
        });

        const geojson = {
            type: 'FeatureCollection',
            features,
            toolMetadata: {
                name: this.name,
                params: { ...params, Input: file.name, 'Lat Column': latCol, 'Long Column': longCol },
                timestamp: new Date().toISOString()
            }
        };

        this.attachImportSummary(geojson, importSummary);

        const res = this.addToMap(geojson);
        const warningSummary = importSummary.skippedCount ? ` ${importSummary.skippedCount} row(s) skipped.` : '';
        this.setStatus(0, `Imported ${importSummary.importedCount} feature(s) from ${file.name}.${warningSummary}`.trim());
        return { ...res, importSummary };
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
        const additions = Array.isArray(geojson) ? geojson : [geojson];
        const res = applyResult({ addGeojson: additions });
        // Fit bounds best-effort using temporary layer(s)
        try {
            const bounds = [];
            additions.forEach((item) => {
                const tmp = L.geoJSON(item);
                const tmpBounds = tmp.getBounds && tmp.getBounds();
                if (tmpBounds && typeof tmpBounds.isValid === 'function' && tmpBounds.isValid()) {
                    bounds.push(tmpBounds);
                }
            });
            if (bounds.length === 1) {
                map.fitBounds(bounds[0]);
            } else if (bounds.length > 1 && typeof L !== 'undefined' && L && typeof L.featureGroup === 'function') {
                const group = L.featureGroup(bounds.map((_, index) => L.geoJSON(additions[index])));
                map.fitBounds(group.getBounds());
            }
        } catch (_) {}
        return res;
    }

    renderUI(paramValues = {}) {
        super.renderUI(paramValues);
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

        const toolContent = document.getElementById('toolContent');
        const executeButton = toolContent.querySelector('button:last-of-type');
        if (!toolContent || !executeButton) return;

        const sampleHint = document.createElement('p');
        sampleHint.textContent = 'Or load a bundled sample dataset for a quick demo.';

        const sampleButton = document.createElement('button');
        sampleButton.type = 'button';
        sampleButton.id = 'loadSampleDataButton';
        sampleButton.textContent = 'Load Sample Data';
        sampleButton.addEventListener('click', () => this.loadSampleData());

        toolContent.insertBefore(sampleHint, executeButton);
        toolContent.insertBefore(sampleButton, executeButton);
        toolContent.insertBefore(document.createElement('br'), executeButton);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AddDataTool };
} else {
    window.AddDataTool = AddDataTool;
}
