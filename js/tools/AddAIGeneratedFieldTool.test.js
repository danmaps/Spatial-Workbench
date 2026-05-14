const mockGenerateFieldValues = jest.fn();
const mockGetLayersByDatasetId = jest.fn();
const mockListLayerGroups = jest.fn(() => []);

jest.mock('../ai/fieldGeneration', () => ({
  generateFieldValues: (...args) => mockGenerateFieldValues(...args),
}));

jest.mock('../state', () => ({
  getLayersByDatasetId: (...args) => mockGetLayersByDatasetId(...args),
  listLayerGroups: (...args) => mockListLayerGroups(...args),
}));

describe('AddAIGeneratedFieldTool', () => {
  let AddAIGeneratedFieldTool;

  beforeEach(() => {
    jest.resetModules();
    mockGenerateFieldValues.mockReset();
    mockGetLayersByDatasetId.mockReset();
    mockListLayerGroups.mockReset();

    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
      <div id="toolContent"></div>
      <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>
    `;

    ({ AddAIGeneratedFieldTool } = require('./AddAIGeneratedFieldTool'));
  });

  test('updates all features headlessly when no selection is supplied', async () => {
    mockGenerateFieldValues.mockImplementation(async ({ features }) => features.map((feature, index) => ({
      id: feature.properties.__id,
      value: `label-${index + 1}`,
    })));

    const tool = new AddAIGeneratedFieldTool();
    const result = await tool.run(
      {
        'Instruction': 'Create a short label',
        'Output Field Name': 'ai_label',
        'Source Fields': 'name,status',
        'Output Type': 'text',
      },
      {
        headless: true,
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', name: 'One', status: 'open' }, geometry: { type: 'Point', coordinates: [0, 0] } },
              { type: 'Feature', properties: { __id: 'f-2', name: 'Two', status: 'open' }, geometry: { type: 'Point', coordinates: [1, 1] } },
            ],
          },
        },
      }
    );

    expect(mockGenerateFieldValues).toHaveBeenCalledTimes(1);
    expect(mockGenerateFieldValues.mock.calls[0][0].features).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(2);
    expect(result.state.featureCollection.features[0].properties.ai_label).toBe('label-1');
    expect(result.state.featureCollection.features[1].properties.ai_label).toBe('label-2');
  });

  test('updates selected features headlessly', async () => {
    mockGenerateFieldValues.mockResolvedValue([
      { id: 'f-2', value: 'high priority' },
    ]);

    const tool = new AddAIGeneratedFieldTool();
    const result = await tool.run(
      {
        'Instruction': 'Create a short label',
        'Output Field Name': 'ai_label',
        'Source Fields': 'name,status',
        'Output Type': 'text',
      },
      {
        headless: true,
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', name: 'One', status: 'open' }, geometry: { type: 'Point', coordinates: [0, 0] } },
              { type: 'Feature', properties: { __id: 'f-2', name: 'Two', status: 'open' }, geometry: { type: 'Point', coordinates: [1, 1] } },
            ],
          },
          selection: {
            featureIds: ['f-2'],
          },
        },
      }
    );

    expect(mockGenerateFieldValues).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(result.state.featureCollection.features[0].properties.ai_label).toBeUndefined();
    expect(result.state.featureCollection.features[1].properties.ai_label).toBe('high priority');
  });

  test('rejects overwrite collisions when overwrite is false', async () => {
    const tool = new AddAIGeneratedFieldTool();
    const result = await tool.run(
      {
        'Instruction': 'Create a short label',
        'Output Field Name': 'ai_label',
        'Source Fields': 'name',
        'Output Type': 'text',
      },
      {
        headless: true,
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', name: 'One', ai_label: 'keep' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            ],
          },
          selection: {
            featureIds: ['f-1'],
          },
        },
      }
    );

    expect(result).toBeUndefined();
    expect(tool.getStatus().message).toBe('No eligible target features found.');
    expect(mockGenerateFieldValues).not.toHaveBeenCalled();
  });

  test('updates every feature in the selected browser layer group', async () => {
    const layerA = {
      __id: 'f-1',
      feature: { properties: { __id: 'f-1', name: 'One', __datasetId: 'ds-1' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', properties: { __id: 'f-1', name: 'One', __datasetId: 'ds-1' }, geometry: { type: 'Point', coordinates: [0, 0] } })),
      bindPopup: jest.fn(),
    };
    const layerB = {
      __id: 'f-2',
      feature: { properties: { __id: 'f-2', name: 'Two', __datasetId: 'ds-1' } },
      toGeoJSON: jest.fn(() => ({ type: 'Feature', properties: { __id: 'f-2', name: 'Two', __datasetId: 'ds-1' }, geometry: { type: 'Point', coordinates: [1, 1] } })),
      bindPopup: jest.fn(),
    };
    mockGetLayersByDatasetId.mockReturnValue([layerA, layerB]);
    mockGenerateFieldValues.mockImplementation(async ({ features }) => features.map((feature) => ({
      id: feature.properties.__id,
      value: `${feature.properties.name}-label`,
    })));

    const tool = new AddAIGeneratedFieldTool();
    const result = await tool.run({
      'Input Layer': 'ds-1',
      'Instruction': 'Create a short label',
      'Output Field Name': 'ai_label',
      'Source Fields': 'name',
      'Output Type': 'text',
    });

    expect(mockGetLayersByDatasetId).toHaveBeenCalledWith('ds-1');
    expect(mockGenerateFieldValues).toHaveBeenCalledTimes(1);
    expect(mockGenerateFieldValues.mock.calls[0][0].features).toHaveLength(2);
    expect(result.updatedCount).toBe(2);
    expect(layerA.feature.properties.ai_label).toBe('One-label');
    expect(layerB.feature.properties.ai_label).toBe('Two-label');
    expect(tool.getStatus().message).toBe('Updated 2 feature(s).');
  });
});
