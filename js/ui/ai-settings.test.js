const { DEFAULT_OLLAMA_MODEL } = require('../ai-providers');
const {
  fetchProviderConfig,
  getProviderModels,
  renderAISettings,
  renderModelControl,
} = require('./ai-settings');

describe('ai settings helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    localStorage.clear();
    global.fetch = jest.fn();
    window.__SWB_API_BASE__ = '';
  });

  afterEach(() => {
    delete window.__SWB_API_BASE__;
  });

  test('fetchProviderConfig loads provider metadata from the server', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, providers: [{ id: 'ollama', models: [] }] }),
    });

    const result = await fetchProviderConfig('/base');

    expect(global.fetch).toHaveBeenCalledWith('/base/api/providers');
    expect(result.providers[0].id).toBe('ollama');
  });

  test('getProviderModels returns provider model list when present', () => {
    const models = getProviderModels({
      providers: [{ id: 'ollama', models: [{ id: 'qwen3:8b', label: 'qwen3:8b' }] }],
    }, 'ollama');

    expect(models).toEqual([{ id: 'qwen3:8b', label: 'qwen3:8b' }]);
  });

  test('renderModelControl shows ollama model picker and defaults to local coder model', () => {
    const modelInput = document.createElement('input');
    const modelSelect = document.createElement('select');

    renderModelControl({
      providerConfig: {
        providers: [{
          id: 'ollama',
          defaultModel: DEFAULT_OLLAMA_MODEL,
          models: [
            { id: DEFAULT_OLLAMA_MODEL, label: DEFAULT_OLLAMA_MODEL },
            { id: 'qwen3:8b', label: 'qwen3:8b' },
          ],
        }],
      },
      providerId: 'ollama',
      modelInput,
      modelSelect,
    });

    expect(modelSelect.style.display).toBe('');
    expect(modelInput.style.display).toBe('none');
    expect(modelInput.value).toBe(DEFAULT_OLLAMA_MODEL);
    expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual([
      DEFAULT_OLLAMA_MODEL,
      'qwen3:8b',
    ]);
  });

  test('renderAISettings loads live provider config, saves selected ollama model, and shows issue link', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        default: 'ollama',
        providers: [{
          id: 'ollama',
          defaultModel: DEFAULT_OLLAMA_MODEL,
          requiresKey: false,
          defaultUrl: 'http://localhost:11434',
          models: [
            { id: DEFAULT_OLLAMA_MODEL, label: DEFAULT_OLLAMA_MODEL },
            { id: 'qwen3:4b', label: 'qwen3:4b' },
          ],
        }],
      }),
    });

    const root = document.getElementById('root');
    await renderAISettings(root);

    const providerSelect = root.querySelector('#ai-provider');
    const modelSelect = root.querySelector('#ai-model-select');
    const saveButton = Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Save');
    const issuesLink = root.querySelector('.settings-meta-link');

    expect(providerSelect.value).toBe('ollama');
    expect(modelSelect.value).toBe(DEFAULT_OLLAMA_MODEL);
    expect(issuesLink).not.toBeNull();
    expect(issuesLink.href).toBe('https://github.com/danmaps/Spatial-Workbench/issues');

    modelSelect.value = 'qwen3:4b';
    modelSelect.dispatchEvent(new Event('change'));
    saveButton.click();

    expect(localStorage.getItem('SWB_AI_PROVIDER')).toBe('ollama');
    expect(localStorage.getItem('SWB_AI_MODEL')).toBe('qwen3:4b');
  });
});
