const mockConvertTextsToNumbersWithAI = jest.fn();

jest.mock('../ai/numericConversion', () => {
  const actual = jest.requireActual('../ai/numericConversion');
  return {
    ...actual,
    convertTextsToNumbersWithAI: (...args) => mockConvertTextsToNumbersWithAI(...args),
  };
});

describe('ConvertTextToNumericTool', () => {
  let ConvertTextToNumericTool;

  beforeEach(() => {
    jest.resetModules();
    mockConvertTextsToNumbersWithAI.mockReset();
    ({ ConvertTextToNumericTool } = require('./ConvertTextToNumericTool'));
  });

  test('parses common numeric text formats without AI', async () => {
    const tool = new ConvertTextToNumericTool();
    const result = await tool.run(
      {
        'Input Field Name': 'raw',
        'Output Field Name': 'parsed',
        'Use AI Fallback': false,
      },
      {
        headless: true,
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', raw: '$1,234.50' }, geometry: { type: 'Point', coordinates: [0, 0] } },
              { type: 'Feature', properties: { __id: 'f-2', raw: '(42)' }, geometry: { type: 'Point', coordinates: [1, 1] } },
              { type: 'Feature', properties: { __id: 'f-3', raw: '12 km' }, geometry: { type: 'Point', coordinates: [2, 2] } },
            ],
          },
          selection: {
            featureIds: ['f-1', 'f-2', 'f-3'],
          },
        },
      }
    );

    const features = result.state.featureCollection.features;
    expect(features[0].properties.parsed).toBe(1234.5);
    expect(features[1].properties.parsed).toBe(-42);
    expect(features[2].properties.parsed).toBe(12);
    expect(mockConvertTextsToNumbersWithAI).not.toHaveBeenCalled();
  });

  test('uses AI fallback only for unresolved values', async () => {
    mockConvertTextsToNumbersWithAI.mockResolvedValue([
      { id: 'f-2', value: 7 },
      { id: 'f-3', value: null },
    ]);

    const tool = new ConvertTextToNumericTool();
    const result = await tool.run(
      {
        'Input Field Name': 'raw',
        'Output Field Name': 'parsed',
        'Use AI Fallback': true,
      },
      {
        headless: true,
        state: {
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { __id: 'f-1', raw: '100' }, geometry: { type: 'Point', coordinates: [0, 0] } },
              { type: 'Feature', properties: { __id: 'f-2', raw: 'seven' }, geometry: { type: 'Point', coordinates: [1, 1] } },
              { type: 'Feature', properties: { __id: 'f-3', raw: 'unknown' }, geometry: { type: 'Point', coordinates: [2, 2] } },
            ],
          },
          selection: {
            featureIds: ['f-1', 'f-2', 'f-3'],
          },
        },
      }
    );

    const features = result.state.featureCollection.features;
    expect(features[0].properties.parsed).toBe(100);
    expect(features[1].properties.parsed).toBe(7);
    expect(features[2].properties.parsed).toBeNull();
    expect(result.failedFeatureIds).toEqual(['f-3']);
    expect(mockConvertTextsToNumbersWithAI).toHaveBeenCalledTimes(1);
  });
});
