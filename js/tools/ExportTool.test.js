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

    const exportedGeoJSON = JSON.parse(result.download.data);
    expect(exportedGeoJSON).toEqual({
      type: 'FeatureCollection',
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ __id: 'feature-2' }) }),
      ],
      toolMetadata: expect.objectContaining({
        name: 'Export',
        parentLayerId: 'input-1',
        params: expect.objectContaining({ Layer: 'input-1', Format: 'GeoJSON' }),
        target: expect.objectContaining({
          mode: 'selection',
          selectedFeatureIds: ['feature-2'],
          selectedFeatureCount: 1,
          totalFeatureCount: 2,
        }),
        timestamp: expect.any(String),
      }),
      toolHistory: [
        expect.objectContaining({
          name: 'Export',
          parentLayerId: 'input-1',
          target: expect.objectContaining({ mode: 'selection' }),
        }),
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
      toolHistory: [
        { name: 'Import', timestamp: '2026-08-28T01:00:00.000Z' },
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

    expect(JSON.parse(result.download.data)).toEqual({
      ...sourceGeoJSON,
      toolMetadata: expect.objectContaining({
        name: 'Export',
        parentLayerId: 'input-1',
        params: expect.objectContaining({ Layer: 'input-1', Format: 'GeoJSON' }),
        target: expect.objectContaining({
          mode: 'layer',
          selectedFeatureIds: [],
          selectedFeatureCount: 0,
          totalFeatureCount: 2,
        }),
        timestamp: expect.any(String),
      }),
      toolHistory: [
        expect.objectContaining({
          name: 'Import',
          timestamp: '2026-08-28T01:00:00.000Z',
        }),
        expect.objectContaining({
          name: 'Export',
          parentLayerId: 'input-1',
          target: expect.objectContaining({ mode: 'layer' }),
        }),
      ],
    });
    expect(result.download.filename).toBe('input-1.geojson');
    expect(tool.getStatus()).toEqual(expect.objectContaining({
      code: 0,
      message: 'Prepared GeoJSON export.',
    }));
    expect(sourceGeoJSON).not.toHaveProperty('toolMetadata');
  });

  test('exports all layers into a combined FeatureCollection with per-layer provenance when Layer is __all__', async () => {
    const layerOneGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { __id: 'pt-1', name: 'Origin' } },
      ],
      toolHistory: [{ name: 'Draw', timestamp: '2026-11-22T01:00:00.000Z' }],
    };
    const layerTwoGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] }, properties: { __id: 'buf-1' } },
      ],
      toolMetadata: { name: 'Buffer', parentLayerId: 'layer-1' },
      toolHistory: [
        { name: 'Draw', timestamp: '2026-11-22T01:00:00.000Z' },
        { name: 'Buffer', parentLayerId: 'layer-1', timestamp: '2026-11-22T01:01:00.000Z' },
      ],
    };

    const layersById = {
      'layer-1': { toGeoJSON: () => layerOneGeoJSON },
      'layer-2': { toGeoJSON: () => layerTwoGeoJSON },
    };

    const tool = new ExportTool();
    const result = await tool.run(
      {
        Layer: '__all__',
        Format: 'GeoJSON',
      },
      {
        listLayers: () => [
          { id: 'layer-1', displayName: 'Origin Points' },
          { id: 'layer-2', displayName: 'Buffered Origin' },
        ],
        getLayer: (id) => layersById[id] || null,
        state: {},
      }
    );

    expect(result.download.filename).toBe('all-layers.geojson');
    expect(tool.getStatus()).toEqual({
      code: 0,
      message: 'Prepared GeoJSON export for 2 layer(s) (2 feature(s)).',
    });

    const exported = JSON.parse(result.download.data);
    expect(exported.type).toBe('FeatureCollection');
    expect(exported.features).toHaveLength(2);
    expect(exported.features[0].properties).toEqual(
      expect.objectContaining({
        __id: 'pt-1',
        __layerId: 'layer-1',
        __layerName: 'Origin Points',
      })
    );
    expect(exported.features[1].properties).toEqual(
      expect.objectContaining({
        __id: 'buf-1',
        __layerId: 'layer-2',
        __layerName: 'Buffered Origin',
      })
    );
    expect(exported.layers).toEqual([
      expect.objectContaining({ id: 'layer-1', name: 'Origin Points', featureCount: 1 }),
      expect.objectContaining({ id: 'layer-2', name: 'Buffered Origin', featureCount: 1 }),
    ]);
    expect(exported.toolMetadata).toEqual(
      expect.objectContaining({
        name: 'Export',
        exportedLayerIds: ['layer-1', 'layer-2'],
        target: expect.objectContaining({
          mode: 'all-layers',
          layerCount: 2,
          totalFeatureCount: 2,
        }),
      })
    );
  });

  test('renderUI includes an All layers option when layers exist', () => {
    mockListLayers.mockReturnValue([
      { id: 'layer-1', label: 'Layer 1' },
      { id: 'layer-2', label: 'Layer 2' },
    ]);

    const tool = new ExportTool();
    tool.renderUI({ Layer: '__all__' });

    const select = document.getElementById('param-Layer');
    const options = Array.from(select.options).map((o) => ({ value: o.value, text: o.text }));
    expect(options).toEqual([
      { value: 'layer-1', text: 'Layer 1' },
      { value: 'layer-2', text: 'Layer 2' },
      { value: '__all__', text: 'All layers (2)' },
    ]);
    expect(select.value).toBe('__all__');

    const formatSelect = document.getElementById('param-Format');
    expect(Array.from(formatSelect.options).map((o) => o.value)).toEqual(['GeoJSON', 'CSV', 'WKT']);
  });

  test('exports layer features as CSV with properties, point coordinates, and WKT geometry (#169)', async () => {
    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
          properties: { __id: 'pt-1', name: 'Ferry Building, SF', category: 'transit' },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-122.42, 37.77], [-122.41, 37.77], [-122.41, 37.78], [-122.42, 37.78], [-122.42, 37.77]]],
          },
          properties: { __id: 'poly-1', name: 'Study Zone "Alpha"', category: 'zone' },
        },
      ],
    };

    const tool = new ExportTool();
    const result = await tool.run(
      {
        Layer: 'study-layer',
        Format: 'CSV',
      },
      {
        getLayer: () => ({ toGeoJSON: () => sourceGeoJSON }),
        state: {},
      }
    );

    expect(result.download.filename).toBe('study-layer.csv');
    expect(result.download.mimeType).toBe('text/csv');
    expect(tool.getStatus()).toEqual({
      code: 0,
      message: 'Prepared CSV export.',
    });

    const lines = result.download.data.split('\n');
    expect(lines[0]).toBe('__id,name,category,geometry_type,longitude,latitude,wkt');
    expect(lines[1]).toBe('pt-1,"Ferry Building, SF",transit,Point,-122.4194,37.7749,POINT (-122.4194 37.7749)');
    expect(lines[2]).toBe(
      'poly-1,"Study Zone ""Alpha""",zone,Polygon,,,"POLYGON ((-122.42 37.77, -122.41 37.77, -122.41 37.78, -122.42 37.78, -122.42 37.77))"'
    );
  });

  test('exports layer features as WKT document (#169)', async () => {
    const { geometryToWkt } = require('./ExportTool');
    expect(
      geometryToWkt({
        type: 'MultiPoint',
        coordinates: [[0, 0], [1, 2]],
      })
    ).toBe('MULTIPOINT ((0 0), (1 2))');
    expect(
      geometryToWkt({
        type: 'LineString',
        coordinates: [[0, 0], [1, 1], [2, 1]],
      })
    ).toBe('LINESTRING (0 0, 1 1, 2 1)');

    const sourceGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
          properties: { __id: 'la-1' },
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-118.25, 34.05], [-118.24, 34.06]] },
          properties: { __id: 'la-line' },
        },
      ],
    };

    const tool = new ExportTool();
    const result = await tool.run(
      {
        Layer: 'la-layer',
        Format: 'WKT',
      },
      {
        getLayer: () => ({ toGeoJSON: () => sourceGeoJSON }),
        state: {},
      }
    );

    expect(result.download.filename).toBe('la-layer.wkt');
    expect(result.download.mimeType).toBe('text/plain');
    expect(result.download.data).toBe(
      'POINT (-118.2437 34.0522)\nLINESTRING (-118.25 34.05, -118.24 34.06)'
    );
    expect(tool.getStatus()).toEqual({
      code: 0,
      message: 'Prepared WKT export.',
    });
  });
});
