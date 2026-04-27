/**
 * AI Settings panel — lets users pick a provider, enter an API key,
 * and configure the Ollama URL.  Everything is stored in localStorage.
 */
const { AI_PROVIDERS, DEFAULT_PROVIDER, STORAGE_KEYS } = require('../ai-providers');

function getVal(key) {
  return localStorage.getItem(key) || '';
}

function setVal(key, v) {
  if (v) localStorage.setItem(key, v);
  else localStorage.removeItem(key);
}

function renderAISettings(container) {
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
  Object.values(AI_PROVIDERS).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === (getVal(STORAGE_KEYS.provider) || DEFAULT_PROVIDER)) opt.selected = true;
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
  modelInput.placeholder = AI_PROVIDERS[providerSelect.value]?.defaultModel || '';
  modelInput.value = getVal(STORAGE_KEYS.model);

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

  // --- Ollama URL field ---
  const urlLabel = document.createElement('label');
  urlLabel.className = 'param-label';
  urlLabel.textContent = 'Ollama URL';
  urlLabel.htmlFor = 'ai-ollama-url';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.id = 'ai-ollama-url';
  urlInput.placeholder = 'http://localhost:11434';
  urlInput.value = getVal(STORAGE_KEYS.ollamaUrl);

  // --- Status indicator ---
  const statusEl = document.createElement('p');
  statusEl.id = 'ai-settings-status';
  statusEl.style.fontSize = '0.85em';
  statusEl.style.minHeight = '1.2em';

  // Toggle visibility of key / url fields based on provider
  function syncVisibility() {
    const prov = providerSelect.value;
    const cfg = AI_PROVIDERS[prov];
    keyLabel.style.display = cfg?.requiresKey ? '' : 'none';
    keyInput.style.display = cfg?.requiresKey ? '' : 'none';
    urlLabel.style.display = prov === 'ollama' ? '' : 'none';
    urlInput.style.display = prov === 'ollama' ? '' : 'none';
    modelInput.placeholder = cfg?.defaultModel || '';
  }
  providerSelect.addEventListener('change', syncVisibility);
  syncVisibility();

  // --- Save ---
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    setVal(STORAGE_KEYS.provider, providerSelect.value);
    setVal(STORAGE_KEYS.apiKey, keyInput.value.trim());
    setVal(STORAGE_KEYS.ollamaUrl, urlInput.value.trim());
    setVal(STORAGE_KEYS.model, modelInput.value.trim());
    statusEl.textContent = '✓ Settings saved';
    statusEl.style.color = '#2ecc71';
  });

  // --- Clear ---
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.marginLeft = '8px';
  clearBtn.addEventListener('click', () => {
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    providerSelect.value = DEFAULT_PROVIDER;
    keyInput.value = '';
    urlInput.value = '';
    modelInput.value = '';
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
      if (key) headers['Authorization'] = `Bearer ${key}`;

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

  // Assemble
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '4px';
  btnRow.style.marginTop = '8px';
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(testBtn);
  btnRow.appendChild(clearBtn);

  wrapper.appendChild(providerLabel);
  wrapper.appendChild(providerSelect);
  wrapper.appendChild(modelLabel);
  wrapper.appendChild(modelInput);
  wrapper.appendChild(keyLabel);
  wrapper.appendChild(keyInput);
  wrapper.appendChild(urlLabel);
  wrapper.appendChild(urlInput);
  wrapper.appendChild(btnRow);
  wrapper.appendChild(statusEl);
  container.appendChild(wrapper);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAISettings };
} else {
  window.renderAISettings = renderAISettings;
}
