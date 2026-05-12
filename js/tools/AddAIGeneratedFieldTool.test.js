const mockGenerateFieldValues = jest.fn();

jest.mock('../ai/fieldGeneration', () => {
  const actual = jest.requireActual('../ai/fieldGeneration');
  return {
    ...actual,
    generateFieldValues: (...args) => mockGenerateFieldValues(...args),
  };
});

describe('AddAIGeneratedFieldTool', () => {
  let AddAIGeneratedFieldTool;

  beforeEach(() => {
    jest.resetModules();
    mockGenerateFieldValues.mockReset();
    ({ AddAIGeneratedFieldTool } = require('./AddAIGeneratedFieldTool'));
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
});
