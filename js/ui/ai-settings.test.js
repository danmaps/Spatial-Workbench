const { DEFAULT_OLLAMA_MODEL } = require('../ai-providers');
const {
  clearWorkspacePreferences,
  fetchProviderConfig,
  getProviderModels,
  getWorkspacePreferences,
  renderAISettings,
  renderModelControl,
  saveWorkspacePreferences,
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
        default: 'openrouter',
        providers: [{
          id: 'openrouter',
          defaultModel: 'openai/gpt-4o',
          requiresKey: true,
        }, {
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

    expect(providerSelect.value).toBe('openrouter');
    expect(modelSelect.style.display).toBe('none');
    expect(issuesLink).not.toBeNull();
    expect(issuesLink.href).toBe('https://github.com/danmaps/Spatial-Workbench/issues');

    providerSelect.value = 'ollama';
    providerSelect.dispatchEvent(new Event('change'));
    modelSelect.value = 'qwen3:4b';
    modelSelect.dispatchEvent(new Event('change'));
    saveButton.click();

    expect(localStorage.getItem('SWB_AI_PROVIDER')).toBe('ollama');
    expect(localStorage.getItem('SWB_AI_MODEL')).toBe('qwen3:4b');
  });

  test('persists consolidated workspace preferences to localStorage and cookies (#63)', async () => {
    clearWorkspacePreferences();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, providers: [] }),
    });

    const root = document.getElementById('root');
    await renderAISettings(root);

    const latInput = root.querySelector('#pref-default-lat');
    const lngInput = root.querySelector('#pref-default-lng');
    const zoomInput = root.querySelector('#pref-default-zoom');
    const basemapSelect = root.querySelector('#pref-basemap');
    const groupTocCheckbox = root.querySelector('#pref-group-toc-layers');
    const saveButton = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Save');

    latInput.value = '37.77';
    lngInput.value = '-122.41';
    zoomInput.value = '11';
    basemapSelect.value = 'light_all';
    groupTocCheckbox.checked = false;

    const eventListener = jest.fn();
    document.addEventListener('spatial-workbench:settings-updated', eventListener);
    saveButton.click();

    const saved = getWorkspacePreferences();
    expect(saved).toEqual({
      defaultLat: 37.77,
      defaultLng: -122.41,
      defaultZoom: 11,
      basemap: 'light_all',
      defaultExportFormat: 'geojson',
      groupTocLayers: false,
    });
    expect(document.cookie).toContain('swb_prefs=');
    expect(eventListener).toHaveBeenCalledTimes(1);

    // Even if localStorage is cleared, cookie fallback preserves preferences
    localStorage.clear();
    expect(getWorkspacePreferences().defaultLat).toBe(37.77);
    expect(getWorkspacePreferences().basemap).toBe('light_all');

    clearWorkspacePreferences();
    expect(saveWorkspacePreferences({ defaultZoom: 9 }).defaultZoom).toBe(9);
  });
});
