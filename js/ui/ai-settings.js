/**
 * AI Settings panel — lets users pick a provider, enter an API key,
 * and configure the Built-in AI URL. Everything is stored in localStorage.
 */
const {
  AI_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_OLLAMA_MODEL,
  STORAGE_KEYS,
} = require('../ai-providers');

function getVal(key) {
  return localStorage.getItem(key) || '';
}

function setVal(key, v) {
  if (v) localStorage.setItem(key, v);
  else localStorage.removeItem(key);
}

function getSavedProvider() {
  return getVal(STORAGE_KEYS.provider) || DEFAULT_PROVIDER;
}

function getSavedModel(providerId) {
  const savedModel = getVal(STORAGE_KEYS.model);
  if (savedModel) return savedModel;
  return AI_PROVIDERS[providerId]?.defaultModel || '';
}

async function fetchProviderConfig(apiBase = '') {
  const response = await fetch(`${apiBase}/api/providers`);
  if (!response.ok) {
    throw new Error(`Failed to load AI provider config (${response.status})`);
  }
  return response.json();
}

function getProviderById(providerConfig, providerId) {
  const provider = providerConfig?.providers?.find((candidate) => candidate.id === providerId);
  if (provider) return provider;
  return AI_PROVIDERS[providerId] || null;
}

function getProviderModels(providerConfig, providerId) {
  const provider = getProviderById(providerConfig, providerId);
  return Array.isArray(provider?.models) ? provider.models : [];
}

function renderModelControl({ providerConfig, providerId, modelInput, modelSelect }) {
  const provider = getProviderById(providerConfig, providerId);
  const models = getProviderModels(providerConfig, providerId);
  const preferredModel = modelInput.value.trim() || getSavedModel(providerId);

  modelInput.placeholder = provider?.defaultModel || '';

  if (providerId === 'ollama' && models.length) {
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label || model.id;
      option.selected = model.id === preferredModel;
      modelSelect.appendChild(option);
    });

    if (!Array.from(modelSelect.options).some((option) => option.selected) && modelSelect.options.length) {
      modelSelect.value = preferredModel || provider?.defaultModel || DEFAULT_OLLAMA_MODEL;
    }

    modelInput.value = modelSelect.value || preferredModel || provider?.defaultModel || DEFAULT_OLLAMA_MODEL;
    modelSelect.style.display = '';
    modelInput.style.display = 'none';
    return;
  }

  modelSelect.innerHTML = '';
  modelSelect.style.display = 'none';
  modelInput.style.display = '';
  if (!modelInput.value.trim()) {
    modelInput.value = preferredModel || provider?.defaultModel || '';
  }
}

async function renderAISettings(container) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'ai-settings';

  // --- Provider dropdown ---
  const providerLabel = document.createElement('label');
  providerLabel.className = 'param-label';
  providerLabel.textContent = 'Provider';
  providerLabel.htmlFor = 'ai-provider';

  const providerSelect = document.createElement('select');
  providerSelect.id = 'ai-provider';
  Object.values(AI_PROVIDERS).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === getSavedProvider()) opt.selected = true;
    providerSelect.appendChild(opt);
  });

  // --- Model field ---
  const modelLabel = document.createElement('label');
  modelLabel.className = 'param-label';
  modelLabel.textContent = 'Model';
  modelLabel.htmlFor = 'ai-model';

  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.id = 'ai-model';
  modelInput.value = getSavedModel(providerSelect.value);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'ai-model-select';
  modelSelect.setAttribute('aria-label', 'Available models');
  modelSelect.style.display = 'none';
  modelSelect.addEventListener('change', () => {
    modelInput.value = modelSelect.value;
  });

  // --- API Key field ---
  const keyLabel = document.createElement('label');
  keyLabel.className = 'param-label';
  keyLabel.textContent = 'API Key';
  keyLabel.htmlFor = 'ai-api-key';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.id = 'ai-api-key';
  keyInput.placeholder = 'sk-...';
  keyInput.value = getVal(STORAGE_KEYS.apiKey);

  // --- Built-in AI URL field ---
  const urlLabel = document.createElement('label');
  urlLabel.className = 'param-label';
  urlLabel.textContent = 'Built-in AI URL';
  urlLabel.htmlFor = 'ai-ollama-url';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.id = 'ai-ollama-url';
  urlInput.placeholder = AI_PROVIDERS.ollama.defaultUrl || 'http://localhost:11434';
  urlInput.value = getVal(STORAGE_KEYS.ollamaUrl) || (AI_PROVIDERS.ollama.defaultUrl || '');

  // --- Status indicator ---
  const statusEl = document.createElement('p');
  statusEl.id = 'ai-settings-status';
  statusEl.style.fontSize = '0.85em';
  statusEl.style.minHeight = '1.2em';

  let providerConfig = null;

  function syncVisibility() {
    const prov = providerSelect.value;
    const cfg = getProviderById(providerConfig, prov) || AI_PROVIDERS[prov];
    keyLabel.style.display = cfg?.requiresKey ? '' : 'none';
    keyInput.style.display = cfg?.requiresKey ? '' : 'none';
    urlLabel.style.display = prov === 'ollama' ? '' : 'none';
    urlInput.style.display = prov === 'ollama' ? '' : 'none';
    renderModelControl({ providerConfig, providerId: prov, modelInput, modelSelect });
  }

  providerSelect.addEventListener('change', syncVisibility);

  // --- Save ---
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    setVal(STORAGE_KEYS.provider, providerSelect.value);
    setVal(STORAGE_KEYS.apiKey, keyInput.value.trim());
    setVal(STORAGE_KEYS.ollamaUrl, urlInput.value.trim());
    setVal(STORAGE_KEYS.model, modelInput.value.trim() || getSavedModel(providerSelect.value));
    statusEl.textContent = '✓ Settings saved';
    statusEl.style.color = '#2ecc71';
  });

  // --- Clear ---
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.marginLeft = '8px';
  clearBtn.addEventListener('click', () => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    providerSelect.value = DEFAULT_PROVIDER;
    keyInput.value = '';
    urlInput.value = AI_PROVIDERS.ollama.defaultUrl || '';
    modelInput.value = getSavedModel(DEFAULT_PROVIDER);
    syncVisibility();
    statusEl.textContent = '✓ Settings cleared';
    statusEl.style.color = 'var(--text-secondary)';
  });

  // --- Test connection ---
  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test';
  testBtn.style.marginLeft = '8px';
  testBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Testing…';
    statusEl.style.color = 'var(--text-secondary)';
    try {
      const apiBase = (typeof window !== 'undefined' && window.__SWB_API_BASE__) || '';
      const headers = { 'Content-Type': 'application/json' };
      const key = keyInput.value.trim();
      if (key) headers.Authorization = `Bearer ${key}`;

      const body = {
        prompt: 'Return a single GeoJSON Point at 0,0.',
        provider: providerSelect.value,
      };
      const url = urlInput.value.trim();
      if (url) body.ollamaUrl = url;
      const model = modelInput.value.trim();
      if (model) body.model = model;

      const resp = await fetch(`${apiBase}/api/ai_geojson`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        statusEl.textContent = '✓ Connection successful';
        statusEl.style.color = '#2ecc71';
      } else {
        const err = await resp.json().catch(() => ({}));
        statusEl.textContent = `✗ ${err.error || resp.status}`;
        statusEl.style.color = '#e74c3c';
      }
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
      statusEl.style.color = '#e74c3c';
    }
  });

  const issuesLink = document.createElement('a');
  issuesLink.className = 'settings-meta-link';
  issuesLink.href = 'https://github.com/danmaps/Spatial-Workbench/issues';
  issuesLink.target = '_blank';
  issuesLink.rel = 'noopener noreferrer';
  issuesLink.textContent = 'Report an issue ↗';

  // Assemble
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '4px';
  btnRow.style.marginTop = '8px';
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(testBtn);
  btnRow.appendChild(clearBtn);

  const footerRow = document.createElement('div');
  footerRow.className = 'settings-meta-row';
  footerRow.appendChild(issuesLink);

  wrapper.appendChild(providerLabel);
  wrapper.appendChild(providerSelect);
  wrapper.appendChild(modelLabel);
  wrapper.appendChild(modelInput);
  wrapper.appendChild(modelSelect);
  wrapper.appendChild(keyLabel);
  wrapper.appendChild(keyInput);
  wrapper.appendChild(urlLabel);
  wrapper.appendChild(urlInput);
  wrapper.appendChild(btnRow);
  wrapper.appendChild(statusEl);
  wrapper.appendChild(footerRow);
  container.appendChild(wrapper);

  try {
    const apiBase = (typeof window !== 'undefined' && window.__SWB_API_BASE__) || '';
    providerConfig = await fetchProviderConfig(apiBase);
  } catch (error) {
    statusEl.textContent = 'Using built-in AI defaults; live Ollama models could not be loaded.';
    statusEl.style.color = 'var(--text-secondary)';
  }

  syncVisibility();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchProviderConfig,
    getProviderModels,
    renderAISettings,
    renderModelControl,
  };
} else {
  window.renderAISettings = renderAISettings;
}
