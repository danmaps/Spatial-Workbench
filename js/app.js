/* global L, turf */  // Tell ESLint that L and turf are global variables

const toolNames = ['RandomPointsTool', 'BufferTool', 'ExportTool', 'GenerateAIFeatures', 'GroupTool', 'AddDataTool']; // Keep this up to date

const state = require('./state');
const { renderAISettings } = require('./ui/ai-settings');

// Initialize the map
const map = L.map('map').setView([34, -117], 7);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
}).addTo(map);

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Set up an array to keep track of layers added to the TOC
const tocLayers = [];
const loadedTools = {}; // Object to store instantiated tools
const selectedLayerIds = new Set();
let openLayerMenuId = null;

let drawControl = new L.Control.Draw({
    draw: {
        // Options here
    },
    edit: {
        featureGroup: drawnItems,
    },
});
map.addControl(drawControl);

function getLayerHistorySummary(layer) {
    const info = state.getLayerInfo(layer);
    const history = info?.provenance?.history || [];
    return history.map((entry) => entry.name || 'Unknown step');
}

function getGeometryLabel(geometryType) {
    const type = geometryType || 'Layer';
    if (type === 'Point' || type === 'MultiPoint') return 'Point';
    if (type === 'LineString' || type === 'MultiLineString') return 'Line';
    if (type === 'Polygon' || type === 'MultiPolygon') return 'Polygon';
    return type;
}

function getDefaultLayerName(layer) {
    const info = state.getLayerInfo(layer);
    if (!info) return 'Layer';

    const importSummary = info.properties?.importSummary;
    const metadata = info.metadata || {};
    const parentName = metadata.parentLayerId ? state.getLayerName(metadata.parentLayerId) : '';
    const geometryLabel = getGeometryLabel(info.geometryType);

    if (importSummary?.fileName) {
        return importSummary.fileName.replace(/\.[^/.]+$/, '');
    }

    if (metadata.name === 'Draw') {
        const index = tocLayers
            .filter((candidate) => {
                const candidateInfo = state.getLayerInfo(candidate);
                return getGeometryLabel(candidateInfo?.geometryType) === geometryLabel;
            })
            .findIndex((candidate) => state.ensureStableId(candidate) === info.id);
        return `${geometryLabel} ${index + 1}`;
    }

    if (metadata.name === 'Buffer' && parentName) return `Buffer of ${parentName}`;
    if (metadata.name === 'Random Points' && parentName) return `Random points from ${parentName}`;
    if (metadata.name === 'Group' && parentName) return `Grouped ${parentName}`;
    if (metadata.name === 'Add Data') return geometryLabel;
    if (metadata.name && parentName) return `${metadata.name} from ${parentName}`;
    if (metadata.name) return `${metadata.name} ${geometryLabel}`;

    return geometryLabel;
}

function getLayerLabel(layer, fallbackMessage) {
    const info = state.getLayerInfo(layer);
    const explicitName = state.getLayerName(layer);
    const preferredName = explicitName || info?.displayName || getDefaultLayerName(layer);
    if (preferredName) return preferredName;
    return fallbackMessage || info?.label || info?.id || 'Layer';
}

function getLayerSourceBadge(layer) {
    const info = state.getLayerInfo(layer);
    const source = info?.source || {};

    if (source.kind === 'imported') return { label: source.label, tone: 'imported' };
    if (source.kind === 'derived') return { label: source.label, tone: 'derived' };
    if (source.kind === 'manual') return { label: source.label, tone: 'manual' };
    if (source.kind === 'ai') return { label: source.label, tone: 'ai' };
    if (source.kind === 'tool') return { label: source.label, tone: 'tool' };

    return { label: source.label || 'Layer', tone: 'default' };
}

function beginRenameLayer(layer, titleEl) {
    const stableId = state.ensureStableId(layer);
    const currentName = getLayerLabel(layer);
    if (!titleEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename-input';
    input.value = currentName;
    input.setAttribute('aria-label', `Rename layer ${stableId}`);

    const commit = () => {
        const nextName = input.value.trim() || getDefaultLayerName(layer);
        state.setLayerName(layer, nextName);
        renderToc();
        updateDataContent();
    };

    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commit();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            renderToc();
        }
    });
    input.addEventListener('blur', commit, { once: true });

    titleEl.replaceWith(input);
    input.focus();
    input.select();
}

function removeLayerWithGuard(layer) {
    const stableId = state.ensureStableId(layer);
    const label = getLayerLabel(layer);
    const childIds = state.getChildLayerIds(stableId);

    const confirmed = childIds.length
        ? window.confirm(`Remove \"${label}\" and its ${childIds.length} derived layer${childIds.length === 1 ? '' : 's'}?`)
        : window.confirm(`Remove \"${label}\"?`);

    if (!confirmed) return;

    if (childIds.length) {
        state.removeLayerTree(stableId);
        childIds.forEach((id) => selectedLayerIds.delete(id));
    } else {
        state.removeLayer(stableId);
    }

    selectedLayerIds.delete(stableId);
    updateDataContent();
}

function getLayerTypeForIcon(layer, type) {
    if (type) return type;
    const info = state.getLayerInfo(layer);
    const geometryType = info?.geometryType;
    if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'marker';
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'polyline';
    return 'polygon';
}

function createActionButton(iconClass, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-action';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i class="${iconClass}"></i>`;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick(event);
    });
    return button;
}

function closeLayerMenu() {
    if (openLayerMenuId === null) return;
    openLayerMenuId = null;
    renderToc();
}

function toggleLayerMenu(stableId) {
    openLayerMenuId = openLayerMenuId === stableId ? null : stableId;
    renderToc();
}

function updateSelectionSummary() {
    const button = document.getElementById('zoomSelectionButton');
    const summary = document.getElementById('selectionSummary');
    if (button) button.disabled = selectedLayerIds.size === 0;
    if (summary) {
        summary.textContent = selectedLayerIds.size ? `${selectedLayerIds.size} selected` : 'No selection';
    }
}

function openLayerProperties(layerOrId) {
    const info = state.getLayerInfo(layerOrId);
    if (!info) return;

    const title = document.getElementById('layerPropertiesTitle');
    const body = document.getElementById('layerPropertiesBody');
    if (!title || !body) return;

    title.textContent = `${info.geometryType || 'Layer'} · ${info.id}`;

    const metadataRows = [];
    if (info.provenance?.metadata?.name) metadataRows.push(['Created By', info.provenance.metadata.name]);
    if (info.provenance?.metadata?.timestamp) metadataRows.push(['Timestamp', info.provenance.metadata.timestamp]);
    if (info.source?.parentLayerId) metadataRows.push(['Parent Layer', info.source.parentLayerId]);
    metadataRows.push(['Visible', info.ui?.visible ? 'Yes' : 'No']);

    const sourceRows = [];
    if (info.source?.kind) sourceRows.push(['Source Type', info.source.label || info.source.kind]);
    if (info.source?.input) sourceRows.push(['Input', info.source.input]);
    if (info.source?.provider) sourceRows.push(['Provider', info.source.provider]);
    const importSummary = info.source?.importSummary || info.properties?.importSummary;
    if (importSummary) {
        sourceRows.push(['Imported Features', `${importSummary.importedCount}`]);
        if (importSummary.skippedCount) sourceRows.push(['Skipped Rows', `${importSummary.skippedCount}`]);
        if (importSummary.detectedColumns?.lat && importSummary.detectedColumns?.lon) {
            sourceRows.push(['Detected Columns', `${importSummary.detectedColumns.lat}, ${importSummary.detectedColumns.lon}`]);
        }
    }

    const geometryRows = [];
    geometryRows.push(['Geometry Type', info.geometry?.type || info.geometryType || 'Unknown']);
    geometryRows.push(['Feature Count', `${info.geometry?.featureCount || 0}`]);
    if (info.bounds) {
        geometryRows.push(['Bounds', info.bounds.toBBoxString ? info.bounds.toBBoxString() : 'Available']);
    }

    const history = info.provenance?.history || info.history || [];
    const historyList = history.length
        ? `<ol class="properties-history">${history.map((entry) => `<li><strong>${entry.name || 'Unknown step'}</strong>${entry.timestamp ? ` <span class="text-muted">${entry.timestamp}</span>` : ''}${entry.parentLayerId ? `<div class="properties-note">from ${entry.parentLayerId}</div>` : ''}</li>`).join('')}</ol>`
        : '<p class="properties-empty">No tool history recorded yet.</p>';

    const importWarnings = Array.isArray(importSummary?.warnings) && importSummary.warnings.length
        ? `<ul class="properties-warnings">${importSummary.warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul>`
        : '<p class="properties-empty">No import warnings.</p>';

    body.innerHTML = `
        <section class="properties-section">
            <h6>Metadata</h6>
            ${renderKeyValueTable(metadataRows, 'No metadata recorded.')}
        </section>
        <section class="properties-section">
            <h6>Source</h6>
            ${renderKeyValueTable(sourceRows, 'No source details available.')}
        </section>
        <section class="properties-section">
            <h6>Geometry</h6>
            ${renderKeyValueTable(geometryRows, 'No geometry details available.')}
        </section>
        <section class="properties-section">
            <h6>Tool History</h6>
            ${historyList}
        </section>
        <section class="properties-section">
            <h6>Properties</h6>
            <pre class="properties-json">${escapeHtml(JSON.stringify(info.properties || {}, null, 2))}</pre>
        </section>
        <section class="properties-section">
            <h6>Import Warnings</h6>
            ${importWarnings}
        </section>
    `;

    const modalEl = document.getElementById('layerPropertiesModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

function renderKeyValueTable(rows, emptyMessage) {
    if (!rows.length) return `<p class="properties-empty">${emptyMessage}</p>`;
    return `<table class="properties-table"><tbody>${rows.map(([key, value]) => `<tr><th>${escapeHtml(String(key))}</th><td>${escapeHtml(String(value))}</td></tr>`).join('')}</tbody></table>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function zoomToLayer(layerOrId) {
    const layer = typeof layerOrId === 'string' ? state.getLayer(layerOrId) : layerOrId;
    const bounds = state.getLayerBounds(layer);
    if (bounds && typeof map.fitBounds === 'function') {
        map.fitBounds(bounds, { padding: [32, 32] });
        return true;
    }

    try {
        if (layer && typeof layer.getLatLng === 'function') {
            map.setView(layer.getLatLng(), Math.max(map.getZoom(), 14));
            return true;
        }
    } catch (_) {}

    return false;
}

function zoomToSelection() {
    const selectedLayers = Array.from(selectedLayerIds)
        .map((id) => state.getLayer(id))
        .filter(Boolean);

    if (!selectedLayers.length) return false;

    const group = L.featureGroup(selectedLayers.filter((layer) => state.getLayerBounds(layer)));
    if (group.getLayers().length) {
        map.fitBounds(group.getBounds(), { padding: [32, 32] });
        return true;
    }

    return zoomToLayer(selectedLayers[0]);
}

function renderImportSummary(summary) {
    const container = document.getElementById('importSummary');
    if (!container) return;

    if (!summary) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    const warningList = (summary.warnings || []).length
        ? `<ul>${summary.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
        : '<p class="mb-0">No warnings.</p>';

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="import-summary-card">
            <div class="import-summary-header">
                <div>
                    <strong>Import Summary</strong>
                    <div class="import-summary-file">${escapeHtml(summary.fileName || 'Imported data')}</div>
                </div>
                <button type="button" class="toc-action" id="dismissImportSummary" aria-label="Dismiss import summary">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="import-summary-grid">
                <div><span>Imported</span><strong>${summary.importedCount}</strong></div>
                <div><span>Skipped</span><strong>${summary.skippedCount}</strong></div>
                <div><span>Format</span><strong>${escapeHtml(summary.fileType || 'unknown')}</strong></div>
                <div><span>Coordinates</span><strong>${escapeHtml(summary.detectedColumns?.lat || '—')} / ${escapeHtml(summary.detectedColumns?.lon || '—')}</strong></div>
            </div>
            <div class="import-summary-warnings">
                <h6>Warnings</h6>
                ${warningList}
            </div>
        </div>
    `;

    const dismiss = document.getElementById('dismissImportSummary');
    if (dismiss) dismiss.addEventListener('click', () => renderImportSummary(null));
}

function renderToc() {
    const tocContent = document.getElementById('tocContent');
    if (!tocContent) return;
    tocContent.innerHTML = '';

    tocLayers.forEach((layer) => {
        const stableId = state.ensureStableId(layer);
        const info = state.getLayerInfo(layer);
        const history = getLayerHistorySummary(layer);
        const sourceBadge = getLayerSourceBadge(layer);
        const menuOpen = openLayerMenuId === stableId;

        const item = document.createElement('div');
        item.className = `layer-message ${selectedLayerIds.has(stableId) ? 'selected' : ''} ${menuOpen ? 'menu-open' : ''}`;
        item.id = `message-${stableId}`;
        item.dataset.layerId = stableId;

        const row = document.createElement('div');
        row.className = 'layer-row';

        const left = document.createElement('div');
        left.className = 'layer-row-main';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'layer-select';
        checkbox.checked = selectedLayerIds.has(stableId);
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectedLayerIds.add(stableId);
            else selectedLayerIds.delete(stableId);
            renderToc();
            updateSelectionSummary();
        });

        const textWrap = document.createElement('div');
        textWrap.className = 'layer-text';

        const title = document.createElement('div');
        title.className = 'layer-title';
        title.textContent = getLayerLabel(layer, info?.label);
        title.title = `${getLayerLabel(layer, info?.label)} · ${stableId}`;
        title.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            beginRenameLayer(layer, title);
        });

        textWrap.appendChild(title);
        left.appendChild(checkbox);
        left.appendChild(textWrap);

        const menuWrap = document.createElement('div');
        menuWrap.className = 'layer-menu-wrap';
        menuWrap.addEventListener('click', (event) => event.stopPropagation());

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'layer-menu-trigger';
        menuButton.setAttribute('aria-label', `Open actions for ${getLayerLabel(layer, info?.label)}`);
        menuButton.setAttribute('aria-haspopup', 'menu');
        menuButton.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
        menuButton.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
        menuButton.addEventListener('click', () => toggleLayerMenu(stableId));

        const menu = document.createElement('div');
        menu.className = `layer-menu ${menuOpen ? 'open' : ''}`;
        menu.setAttribute('role', 'menu');

        const metaSection = document.createElement('div');
        metaSection.className = 'layer-menu-section layer-menu-details';
        metaSection.innerHTML = `
            <div class="layer-menu-label">${info?.geometry?.label || getGeometryLabel(info?.geometryType)} · ${sourceBadge.label}</div>
            <div class="layer-menu-meta">${history.length ? history.join(' → ') : (info?.geometry?.type || info?.geometryType || 'Layer')}</div>
            <div class="layer-menu-id">${stableId}</div>
        `;

        const actionList = document.createElement('div');
        actionList.className = 'layer-menu-section layer-menu-actions';
        actionList.appendChild(createActionButton('fas fa-magnifying-glass-location', 'Zoom to layer', () => {
            closeLayerMenu();
            zoomToLayer(layer);
        }));
        actionList.appendChild(createActionButton('fas fa-pen', 'Rename layer', () => {
            closeLayerMenu();
            beginRenameLayer(layer, title);
        }));
        actionList.appendChild(createActionButton('fas fa-circle-info', 'Layer properties', () => {
            closeLayerMenu();
            openLayerProperties(layer);
        }));
        actionList.appendChild(createActionButton('fas fa-trash', 'Remove layer', () => {
            closeLayerMenu();
            removeLayerWithGuard(layer);
        }));

        menu.appendChild(metaSection);
        menu.appendChild(actionList);
        menuWrap.appendChild(menuButton);
        menuWrap.appendChild(menu);

        row.appendChild(left);
        row.appendChild(menuWrap);
        item.appendChild(row);

        item.addEventListener('click', () => {
            if (selectedLayerIds.has(stableId)) selectedLayerIds.delete(stableId);
            else selectedLayerIds.add(stableId);
            renderToc();
            updateSelectionSummary();
        });

        tocContent.appendChild(item);
    });
}

function refreshSidebarState() {
    renderToc();
    updateSelectionSummary();
}

function addToolHistoryEntry(layer, entry) {
    state.ensureToolHistory(layer, entry);
}

document.getElementById('backButton').addEventListener('click', function() {
    document.getElementById('toolSelection').style.display = 'block';
    document.getElementById('toolDetails').classList.add('hidden');
    const statusMessage = document.getElementById('statusMessageText');
    statusMessage.textContent = '';
    document.getElementById('statusMessage').style.display = 'none';
});

// Function to get a tool instance by name
function getToolByName(name) {
    return loadedTools[name] || null;
}

// Function to update the DataContent div
function updateDataContent() {
    let content = document.getElementById('DataContent');
    // Ensure every layer has a stable id persisted into feature.properties.__id
    try {
        tocLayers.forEach((l) => state.ensureStableId(l));
    } catch (e) {
        // best-effort
    }

    let geoJsonData = JSON.stringify(drawnItems.toGeoJSON(), null, 2);
    content.innerHTML = `<code class="language-json">${Prism.highlight(geoJsonData, Prism.languages.json, 'json')}</code>`;

    const toolElement = document.getElementById('toolName');
    if (toolElement) {
        let toolname = toolElement.getAttribute('tool');
        let tool = getToolByName(toolname);
        if (tool) {
            tool.renderUI();
        }
    }

    refreshSidebarState();
}

// Event listeners remain the same...
map.on(L.Draw.Event.CREATED, function (e) {
    let type = e.layerType,
        layer = e.layer;
    
    drawnItems.addLayer(layer);

    // Assign a stable id immediately.
    const stableId = state.registerLayer(layer);
    addToolHistoryEntry(layer, {
        name: 'Draw',
        timestamp: new Date().toISOString(),
        geometryType: type,
    });

    if (!tocLayers.includes(layer)) tocLayers.push(layer);

    refreshSidebarState();
    updateDataContent();
});

map.on('draw:edited', function (e) {
    var layers = e.layers;
    layers.eachLayer(function (layer) {
        const stableId = state.registerLayer(layer);
        addToolHistoryEntry(layer, {
            name: 'Edit',
            timestamp: new Date().toISOString(),
            layerId: stableId,
        });
        if (!tocLayers.includes(layer)) tocLayers.push(layer);
    });
    updateDataContent();
});

map.on('draw:deleted', function (e) {
    var layers = e.layers;
    layers.eachLayer(function (layer) {
        if (layer && layer.__id) {
            selectedLayerIds.delete(layer.__id);
            // Let state.removeLayer handle removal from drawnItems for tracked layers
            state.removeLayer(layer.__id);
        } else {
            // Fall back to direct removal for untracked layers
            drawnItems.removeLayer(layer);
        }
    });
    updateDataContent();
});

map.on('layeradd', function (e) {
    let layer = e.layer;
    // if layer has a feature.toolMetadata, add the layer to the TOC
    if (layer.hasOwnProperty('feature') && layer.feature.toolMetadata) {
        const stableId = state.registerLayer(layer, layer?.feature?.properties?.__id);
        if (!tocLayers.includes(layer)) tocLayers.push(layer);
        const importSummary = layer.feature?.properties?.importSummary;
        if (importSummary) renderImportSummary(importSummary);
        refreshSidebarState();
    }
});

// Load tools dynamically and store them in the loadedTools object
document.addEventListener('DOMContentLoaded', () => {
    // Load tools synchronously since we're using require
    toolNames.forEach(name => {
        try {
            const ToolClass = require(`./tools/${name}`)[name];
            loadedTools[name] = new ToolClass();
        } catch (error) {
            console.error(`Failed to load tool: ${name}`, error);
        }
    });
    renderToolList(Object.values(loadedTools));

    // Render AI Settings panel
    const aiSettingsContent = document.getElementById('aiSettingsContent');
    if (aiSettingsContent) renderAISettings(aiSettingsContent);

    // Wire up AI Settings back button
    const aiSettingsBack = document.getElementById('aiSettingsBack');
    if (aiSettingsBack) {
        aiSettingsBack.addEventListener('click', () => {
            document.getElementById('aiSettingsPanel').classList.add('hidden');
            document.getElementById('toolSelection').style.display = 'block';
        });
    }

    const zoomSelectionButton = document.getElementById('zoomSelectionButton');
    if (zoomSelectionButton) {
        zoomSelectionButton.addEventListener('click', () => zoomToSelection());
    }

    updateSelectionSummary();
    renderImportSummary(null);
});

function renderToolList(tools) {
    const toolContainer = document.getElementById('toolSelection');
    tools.forEach(tool => {
        const toolDiv = document.createElement('div');
        toolDiv.className = 'tool';
        toolDiv.textContent = tool.name;
        toolDiv.addEventListener('click', () => {
            const toolNameElement = document.getElementById('toolName');
            if (toolNameElement) {
                toolNameElement.setAttribute('tool', tool.constructor.name);
                tool.renderUI();
            } else {
                console.error("Element with ID 'toolName' not found.");
            }
        });
        toolContainer.appendChild(toolDiv);
    });

    // Add AI Settings entry at the bottom
    const settingsDiv = document.createElement('div');
    settingsDiv.className = 'tool ai-settings-trigger';
    settingsDiv.innerHTML = '<i class="fas fa-robot me-2"></i>AI Settings';
    settingsDiv.addEventListener('click', () => {
        document.getElementById('toolSelection').style.display = 'none';
        document.getElementById('aiSettingsPanel').classList.remove('hidden');
    });
    toolContainer.appendChild(settingsDiv);
}

document.addEventListener('click', (event) => {
    if (!event.target.closest('.layer-menu-wrap')) {
        closeLayerMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeLayerMenu();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    updateDataContent();
});

// Export these before any requires to avoid circular dependencies
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        map,
        drawnItems,
        tocLayers,
        zoomToLayer,
        zoomToSelection,
        openLayerProperties,
        renderImportSummary,
    };
}
