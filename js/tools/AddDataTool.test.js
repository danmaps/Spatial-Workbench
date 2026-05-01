const mockFitBounds = jest.fn();
const mockApplyResult = jest.fn(() => ({ ok: true, added: ['a'], removed: [], errors: [] }));

jest.mock('../app', () => ({
  map: {
    fitBounds: (...args) => mockFitBounds(...args),
  },
}));

jest.mock('../state', () => ({
  applyResult: (...args) => mockApplyResult(...args),
}));

describe('AddDataTool', () => {
  let AddDataTool;

  beforeEach(() => {
    jest.resetModules();
    global.L = {
      geoJSON: jest.fn(() => ({
        getBounds: jest.fn(() => ({ isValid: () => true })),
      })),
    };
    ({ AddDataTool } = require('./AddDataTool'));
    mockApplyResult.mockClear();
    mockFitBounds.mockClear();
  });

  test('handleTabular returns import summary and warnings for invalid rows', async () => {
    const tool = new AddDataTool();
    tool.readTabularFile = jest.fn(async () => ([
      { latitude: '34.1', longitude: '-117.2', name: 'ok-1' },
      { latitude: 'bad', longitude: '-117.3', name: 'bad-1' },
      { latitude: '35.0', longitude: '-118.0', name: 'ok-2' },
    ]));

    const result = await tool.handleTabular({ name: 'sample.csv' }, 'csv', {
      Input: { name: 'sample.csv' },
      'Lat Column': '',
      'Long Column': '',
      'Override Columns': false,
    });

    expect(mockApplyResult).toHaveBeenCalledTimes(1);
    expect(result.importSummary).toEqual(expect.objectContaining({
      fileName: 'sample.csv',
      importedCount: 2,
      skippedCount: 1,
      detectedColumns: { lat: 'latitude', lon: 'longitude' },
    }));
    expect(result.importSummary.warnings[0]).toContain('Row 3 skipped');

    const geojson = mockApplyResult.mock.calls[0][0].addGeojson;
    expect(geojson.features).toHaveLength(2);
    expect(geojson.features[0].properties.importSummary.importedCount).toBe(2);
  });

  test('handleGeoJSON attaches import summary to features', async () => {
    const tool = new AddDataTool();
    const file = { name: 'data.geojson' };
    global.FileReader = class {
      readAsText() {
        this.onload({
          target: {
            result: JSON.stringify({
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
              ],
            }),
          },
        });
      }
    };

    const result = await tool.handleGeoJSON(file, { Input: file.name });

    expect(result.importSummary.importedCount).toBe(1);
    const geojson = mockApplyResult.mock.calls[0][0].addGeojson;
    expect(geojson.features[0].properties.importSummary.fileType).toBe('geojson');
  });
});
