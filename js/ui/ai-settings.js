/**
 * Consolidated Settings panel — lets users configure AI provider/model/key,
 * map startup defaults (extent & basemap), and workspace/data preferences.
 * Persists across sessions in both localStorage and a durable browser cookie.
 */
const {
  AI_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_OLLAMA_MODEL,
  STORAGE_KEYS,
} = require('../ai-providers');

const PREFERENCES_COOKIE_NAME = 'swb_prefs';

const WORKSPACE_PREFERENCE_KEYS = Object.freeze({
  defaultLat: 'SWB_DEFAULT_LAT',
  defaultLng: 'SWB_DEFAULT_LNG',
  defaultZoom: 'SWB_DEFAULT_ZOOM',
  basemap: 'SWB_BASEMAP',
  defaultExportFormat: 'SWB_DEFAULT_EXPORT_FORMAT',
  groupTocLayers: 'SWB_GROUP_TOC_LAYERS',
});

const DEFAULT_WORKSPACE_PREFERENCES = Object.freeze({
  defaultLat: 34,
  defaultLng: -117,
  defaultZoom: 7,
  basemap: 'dark_all',
  defaultExportFormat: 'geojson',
  groupTocLayers: true,
});

const BASEMAP_OPTIONS = Object.freeze([
  { id: 'dark_all', label: 'CARTO Dark Matter' },
  { id: 'light_all', label: 'CARTO Positron Light' },
  { id: 'osm', label: 'OpenStreetMap Standard' },
]);

function getVal(key) {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(key) || '';
}

function setVal(key, v) {
  if (typeof localStorage === 'undefined') return;
  if (v !== undefined && v !== null && v !== '') localStorage.setItem(key, String(v));
  else localStorage.removeItem(key);
}

function readPreferencesCookie() {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return {};
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PREFERENCES_COOKIE_NAME}=`));
  if (!match) return {};
  try {
    const raw = decodeURIComponent(match.slice(PREFERENCES_COOKIE_NAME.length + 1));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writePreferencesCookie(prefs) {
  if (typeof document === 'undefined') return;
  try {
    const encoded = encodeURIComponent(JSON.stringify(prefs));
    document.cookie = `${PREFERENCES_COOKIE_NAME}=${encoded}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (_) {}
}

function clearPreferencesCookie() {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${PREFERENCES_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  } catch (_) {}
}

function getWorkspacePreferences() {
  const cookiePrefs = readPreferencesCookie();
  const rawLat = getVal(WORKSPACE_PREFERENCE_KEYS.defaultLat) || cookiePrefs.defaultLat;
  const rawLng = getVal(WORKSPACE_PREFERENCE_KEYS.defaultLng) || cookiePrefs.defaultLng;
  const rawZoom = getVal(WORKSPACE_PREFERENCE_KEYS.defaultZoom) || cookiePrefs.defaultZoom;
  const rawBasemap = getVal(WORKSPACE_PREFERENCE_KEYS.basemap) || cookiePrefs.basemap;
  const rawFormat = getVal(WORKSPACE_PREFERENCE_KEYS.defaultExportFormat) || cookiePrefs.defaultExportFormat;
  const rawGroupToc = getVal(WORKSPACE_PREFERENCE_KEYS.groupTocLayers);

  const parsedLat = Number(rawLat);
  const parsedLng = Number(rawLng);
  const parsedZoom = Number(rawZoom);

  const defaultLat = Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90 && rawLat !== '' && rawLat !== undefined
    ? parsedLat
    : DEFAULT_WORKSPACE_PREFERENCES.defaultLat;
  const defaultLng = Number.isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180 && rawLng !== '' && rawLng !== undefined
    ? parsedLng
    : DEFAULT_WORKSPACE_PREFERENCES.defaultLng;
  const defaultZoom = Number.isFinite(parsedZoom) && parsedZoom >= 1 && parsedZoom <= 18 && rawZoom !== '' && rawZoom !== undefined
    ? Math.round(parsedZoom)
    : DEFAULT_WORKSPACE_PREFERENCES.defaultZoom;
  const basemap = BASEMAP_OPTIONS.some((opt) => opt.id === rawBasemap)
    ? rawBasemap
    : DEFAULT_WORKSPACE_PREFERENCES.basemap;
  const defaultExportFormat = typeof rawFormat === 'string' && rawFormat.trim()
    ? rawFormat.trim().toLowerCase()
    : DEFAULT_WORKSPACE_PREFERENCES.defaultExportFormat;
  const groupTocLayers = rawGroupToc !== ''
    ? rawGroupToc !== 'false'
    : (typeof cookiePrefs.groupTocLayers === 'boolean'
        ? cookiePrefs.groupTocLayers
        : DEFAULT_WORKSPACE_PREFERENCES.groupTocLayers);

  return {
    defaultLat,
    defaultLng,
    defaultZoom,
    basemap,
    defaultExportFormat,
    groupTocLayers,
  };
}

function saveWorkspacePreferences(partialPrefs = {}) {
  const current = getWorkspacePreferences();
  const next = {
    ...current,
    ...partialPrefs,
  };

  setVal(WORKSPACE_PREFERENCE_KEYS.defaultLat, next.defaultLat);
  setVal(WORKSPACE_PREFERENCE_KEYS.defaultLng, next.defaultLng);
  setVal(WORKSPACE_PREFERENCE_KEYS.defaultZoom, next.defaultZoom);
  setVal(WORKSPACE_PREFERENCE_KEYS.basemap, next.basemap);
  setVal(WORKSPACE_PREFERENCE_KEYS.defaultExportFormat, next.defaultExportFormat);
  setVal(WORKSPACE_PREFERENCE_KEYS.groupTocLayers, next.groupTocLayers ? 'true' : 'false');

  const normalized = getWorkspacePreferences();
  writePreferencesCookie({
    ...normalized,
    provider: getSavedProvider(),
    model: getSavedModel(getSavedProvider()),
  });

  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    document.dispatchEvent(
      new CustomEvent('spatial-workbench:settings-updated', {
        detail: normalized,
      })
    );
  }

  return normalized;
}

function clearWorkspacePreferences() {
  Object.values(WORKSPACE_PREFERENCE_KEYS).forEach((key) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  });
  clearPreferencesCookie();
  return getWorkspacePreferences();
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

  // --- Map & Workspace Defaults (#63) ---
  const currentPrefs = getWorkspacePreferences();

  const mapHeading = document.createElement('h5');
  mapHeading.className = 'settings-section-heading mt-3 mb-2';
  mapHeading.textContent = 'Map & Workspace Defaults';

  const latLabel = document.createElement('label');
  latLabel.className = 'param-label';
  latLabel.textContent = 'Default Latitude';
  latLabel.htmlFor = 'pref-default-lat';

  const latInput = document.createElement('input');
  latInput.type = 'number';
  latInput.id = 'pref-default-lat';
  latInput.step = '0.01';
  latInput.min = '-90';
  latInput.max = '90';
  latInput.value = String(currentPrefs.defaultLat);

  const lngLabel = document.createElement('label');
  lngLabel.className = 'param-label';
  lngLabel.textContent = 'Default Longitude';
  lngLabel.htmlFor = 'pref-default-lng';

  const lngInput = document.createElement('input');
  lngInput.type = 'number';
  lngInput.id = 'pref-default-lng';
  lngInput.step = '0.01';
  lngInput.min = '-180';
  lngInput.max = '180';
  lngInput.value = String(currentPrefs.defaultLng);

  const zoomLabel = document.createElement('label');
  zoomLabel.className = 'param-label';
  zoomLabel.textContent = 'Default Zoom';
  zoomLabel.htmlFor = 'pref-default-zoom';

  const zoomInput = document.createElement('input');
  zoomInput.type = 'number';
  zoomInput.id = 'pref-default-zoom';
  zoomInput.step = '1';
  zoomInput.min = '1';
  zoomInput.max = '18';
  zoomInput.value = String(currentPrefs.defaultZoom);

  const basemapLabel = document.createElement('label');
  basemapLabel.className = 'param-label';
  basemapLabel.textContent = 'Default Basemap';
  basemapLabel.htmlFor = 'pref-basemap';

  const basemapSelect = document.createElement('select');
  basemapSelect.id = 'pref-basemap';
  BASEMAP_OPTIONS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.id;
    option.textContent = opt.label;
    if (opt.id === currentPrefs.basemap) option.selected = true;
    basemapSelect.appendChild(option);
  });

  const exportFormatLabel = document.createElement('label');
  exportFormatLabel.className = 'param-label';
  exportFormatLabel.textContent = 'Default Export Format';
  exportFormatLabel.htmlFor = 'pref-export-format';

  const exportFormatSelect = document.createElement('select');
  exportFormatSelect.id = 'pref-export-format';
  ['geojson', 'csv', 'wkt'].forEach((fmt) => {
    const option = document.createElement('option');
    option.value = fmt;
    option.textContent = fmt === 'geojson' ? 'GeoJSON' : fmt.toUpperCase();
    if (fmt === currentPrefs.defaultExportFormat) option.selected = true;
    exportFormatSelect.appendChild(option);
  });

  const groupTocWrap = document.createElement('div');
  groupTocWrap.className = 'settings-checkbox-row mt-2';
  const groupTocInput = document.createElement('input');
  groupTocInput.type = 'checkbox';
  groupTocInput.id = 'pref-group-toc-layers';
  groupTocInput.checked = Boolean(currentPrefs.groupTocLayers);
  const groupTocLabel = document.createElement('label');
  groupTocLabel.className = 'param-label ms-2';
  groupTocLabel.htmlFor = 'pref-group-toc-layers';
  groupTocLabel.textContent = 'Group derived layers under parent in TOC';
  groupTocWrap.appendChild(groupTocInput);
  groupTocWrap.appendChild(groupTocLabel);

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
    saveWorkspacePreferences({
      defaultLat: parseFloat(latInput.value),
      defaultLng: parseFloat(lngInput.value),
      defaultZoom: parseInt(zoomInput.value, 10),
      basemap: basemapSelect.value,
      defaultExportFormat: exportFormatSelect.value,
      groupTocLayers: groupTocInput.checked,
    });
    statusEl.textContent = '✓ Settings saved';
    statusEl.style.color = '#2ecc71';
  });

  // --- Clear ---
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.marginLeft = '8px';
  clearBtn.addEventListener('click', () => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    const resetPrefs = clearWorkspacePreferences();
    providerSelect.value = DEFAULT_PROVIDER;
    keyInput.value = '';
    urlInput.value = AI_PROVIDERS.ollama.defaultUrl || '';
    modelInput.value = getSavedModel(DEFAULT_PROVIDER);
    latInput.value = String(resetPrefs.defaultLat);
    lngInput.value = String(resetPrefs.defaultLng);
    zoomInput.value = String(resetPrefs.defaultZoom);
    basemapSelect.value = resetPrefs.basemap;
    exportFormatSelect.value = resetPrefs.defaultExportFormat;
    groupTocInput.checked = Boolean(resetPrefs.groupTocLayers);
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
  wrapper.appendChild(mapHeading);
  wrapper.appendChild(latLabel);
  wrapper.appendChild(latInput);
  wrapper.appendChild(lngLabel);
  wrapper.appendChild(lngInput);
  wrapper.appendChild(zoomLabel);
  wrapper.appendChild(zoomInput);
  wrapper.appendChild(basemapLabel);
  wrapper.appendChild(basemapSelect);
  wrapper.appendChild(exportFormatLabel);
  wrapper.appendChild(exportFormatSelect);
  wrapper.appendChild(groupTocWrap);
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
    BASEMAP_OPTIONS,
    DEFAULT_WORKSPACE_PREFERENCES,
    PREFERENCES_COOKIE_NAME,
    WORKSPACE_PREFERENCE_KEYS,
    clearWorkspacePreferences,
    fetchProviderConfig,
    getProviderModels,
    getWorkspacePreferences,
    renderAISettings,
    renderModelControl,
    saveWorkspacePreferences,
  };
} else {
  window.renderAISettings = renderAISettings;
}
