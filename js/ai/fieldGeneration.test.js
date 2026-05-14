const mockRequestStructuredData = jest.fn();

jest.mock('./requestStructuredData', () => ({
  requestStructuredData: (...args) => mockRequestStructuredData(...args),
}));

const { generateFieldValues } = require('./fieldGeneration');

describe('fieldGeneration', () => {
  beforeEach(() => {
    mockRequestStructuredData.mockReset();
  });

  test('makes one AI request per feature', async () => {
    mockRequestStructuredData
      .mockResolvedValueOnce({ id: 'f-1', value: 'alpha' })
      .mockResolvedValueOnce({ id: 'f-2', value: 'beta' });

    const result = await generateFieldValues({
      features: [
        { type: 'Feature', properties: { __id: 'f-1', name: 'One' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        { type: 'Feature', properties: { __id: 'f-2', name: 'Two' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      ],
      sourceFields: ['name'],
      instruction: 'Create a label',
      outputFieldName: 'ai_label',
      outputType: 'text',
    });

    expect(mockRequestStructuredData).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { id: 'f-1', value: 'alpha' },
      { id: 'f-2', value: 'beta' },
    ]);
  });
});
