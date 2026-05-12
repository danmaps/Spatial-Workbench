const { DEFAULT_OLLAMA_MODEL } = require('./js/ai-providers');

describe('server ollama config helpers', () => {
  let originalFetch;
  let fetchMock;
  let getOllamaModels;
  let normalizeOllamaUrl;

  beforeEach(() => {
    jest.resetModules();
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    ({ getOllamaModels, normalizeOllamaUrl } = require('./server'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('normalizeOllamaUrl trims trailing slashes', () => {
    expect(normalizeOllamaUrl('http://localhost:11434///')).toBe('http://localhost:11434');
  });

  test('getOllamaModels prefers runtime models and keeps desired default first', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'qwen3:8b' },
          { name: 'qwen3:4b' },
        ],
      }),
    });

    const result = await getOllamaModels('http://localhost:11434');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    expect(result.ok).toBe(true);
    expect(result.defaultModel).toBe(DEFAULT_OLLAMA_MODEL);
    expect(result.models[0]).toEqual({ id: DEFAULT_OLLAMA_MODEL, label: DEFAULT_OLLAMA_MODEL });
    expect(result.models).toEqual(expect.arrayContaining([
      { id: 'qwen3:8b', label: 'qwen3:8b' },
      { id: 'qwen3:4b', label: 'qwen3:4b' },
    ]));
  });

  test('getOllamaModels falls back to known models when runtime lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const result = await getOllamaModels('http://localhost:11434');

    expect(result.ok).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.defaultModel).toBe(DEFAULT_OLLAMA_MODEL);
    expect(result.models[0]).toEqual({ id: DEFAULT_OLLAMA_MODEL, label: DEFAULT_OLLAMA_MODEL });
  });
});
