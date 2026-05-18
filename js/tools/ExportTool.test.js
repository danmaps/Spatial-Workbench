const mockListLayers = jest.fn(() => []);

jest.mock('../state', () => ({
  listLayers: (...args) => mockListLayers(...args),
}));

describe('ExportTool', () => {
  let ExportTool;

  beforeEach(() => {
    jest.resetModules();
    mockListLayers.mockClear();

    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
      <div id="toolContent"></div>
      <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>
      <select id="param-Layer"></select>
      <select id="param-Format"></select>
    `;

    ({ ExportTool } = require('./ExportTool'));
  });

  test('exports only selected features when a relevant layer selection exists', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
      ],
    };

    const tool = new ExportTool();
    const result = await tool.run({
      Layer: 'input-1',
      Format: 'GeoJSON',
    }, {
      getLayer: () => ({ toGeoJSON: () => sourceGeoJSON }),
      state: {
        selection: {
          activeLayerId: 'input-1',
          selectedLayerIds: ['input-1'],
          selectedFeaturesByLayerId: { 'input-1': ['feature-2'] },
        },
      },
    });

    expect(JSON.parse(result.download.data)).toEqual({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ __id: 'feature-2' }) }),
      ],
    });
    expect(result.download.filename).toBe('input-1-selection.geojson');
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Prepared GeoJSON export for 1 selected feature(s).',
    }));
  });

  test('falls back to exporting the whole layer when no relevant selection exists', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'feature-1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { __id: 'feature-2' } },
      ],
    };

    const tool = new ExportTool();
    const result = await tool.run({
      Layer: 'input-1',
      Format: 'GeoJSON',
    }, {
      getLayer: () => ({ toGeoJSON: () => sourceGeoJSON }),
      state: {
        selection: {
          activeLayerId: 'other-layer',
          selectedLayerIds: ['other-layer'],
          selectedFeaturesByLayerId: { 'input-1': ['missing-feature-id'] },
        },
      },
    });

    expect(JSON.parse(result.download.data)).toEqual(sourceGeoJSON);
    expect(result.download.filename).toBe('input-1.geojson');
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Prepared GeoJSON export.',
    }));
  });
});
