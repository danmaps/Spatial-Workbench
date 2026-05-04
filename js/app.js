/* global L, turf */  // Tell ESLint that L and turf are global variables

const toolNames = ['RandomPointsTool', 'BufferTool', 'ExportTool', 'GenerateAIFeatures', 'GroupTool', 'AddDataTool']; // Keep this up to date

const state = require('./state');
const { renderAISettings } = require('./ui/ai-settings');
const { getAttributeModel, parseEditedValue } = require('./ui/attribute-view');
const { initializeDesktopAttributeDrawer } = require('./ui/desktop-attribute-drawer');

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
let activeAttributeLayerId = null;
let activeDesktopAttributeRow = null;
let activeDesktopAttributeCell = null;

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
    if (activeAttributeLayerId === stableId) activeAttributeLayerId = null;
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

function getSelectedLayers() {
    return Array.from(selectedLayerIds)
        .map((id) => state.getLayer(id))
        .filter(Boolean);
}

function syncActiveAttributeLayer() {
    const selectedIds = Array.from(selectedLayerIds).filter((id) => state.getLayer(id));

    if (selectedIds.includes(activeAttributeLayerId)) return;
    if (selectedIds.length) {
        activeAttributeLayerId = selectedIds[0];
        return;
    }

    if (activeAttributeLayerId && state.getLayer(activeAttributeLayerId)) return;
    const firstLayer = tocLayers[0];
    activeAttributeLayerId = firstLayer ? state.ensureStableId(firstLayer) : null;
}

function buildFeaturePopupContent(row) {
    const items = Object.entries(row.properties || {})
        .filter(([key]) => key !== '__id')
        .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—'))}</td></tr>`)
        .join('');

    return `
        <div class="attribute-popup">
            <div class="attribute-popup-title">${escapeHtml(row.title)}</div>
            <table class="popupTable"><tbody>${items || '<tr><td colspan="2">No attributes</td></tr>'}</tbody></table>
        </div>
    `;
}

function zoomToFeature(row) {
    if (!row?.feature) return false;

    try {
        const previewLayer = L.geoJSON(row.feature);
        const bounds = previewLayer.getBounds && previewLayer.getBounds();
        if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [32, 32] });
            map.openPopup(buildFeaturePopupContent(row), bounds.getCenter());
            return true;
        }

        const marker = previewLayer.getLayers && previewLayer.getLayers()[0];
        if (marker && typeof marker.getLatLng === 'function') {
            const latlng = marker.getLatLng();
            map.setView(latlng, Math.max(map.getZoom(), 14));
            map.openPopup(buildFeaturePopupContent(row), latlng);
            return true;
        }
    } catch (_) {}

    return false;
}

function getAttributeLayerTargets(layer) {
    if (!layer) return [];

    if (typeof layer.eachLayer === 'function') {
        const targets = [];
        layer.eachLayer((child) => {
            if (child?.feature) targets.push(child);
        });
        if (targets.length) return targets;
    }

    return layer?.feature ? [layer] : [];
}

function updateAttributeFeatureProperty(layerId, rowIndex, propertyKey, nextValue, originalValue) {
    const layer = state.getLayer(layerId);
    const targets = getAttributeLayerTargets(layer);
    const target = targets[rowIndex];
    if (!target?.feature) return false;

    if (!target.feature.properties) target.feature.properties = {};
    const parsedValue = parseEditedValue(nextValue, originalValue);
    target.feature.properties[propertyKey] = parsedValue;
    return true;
}

function wireAttributeZoomButtons(root, model) {
    Array.from(root.querySelectorAll('[data-feature-index]')).forEach((button) => {
        button.addEventListener('click', () => {
            const row = model.rows[Number(button.dataset.featureIndex)];
            zoomToFeature(row);
        });
    });
}

function wireDesktopAttributeGrid(container, activeInfo, model) {
    const syncGridSelection = (rowIndex, columnKey) => {
        activeDesktopAttributeRow = rowIndex;
        activeDesktopAttributeCell = columnKey;

        Array.from(container.querySelectorAll('tbody tr')).forEach((rowEl) => {
            rowEl.classList.toggle('is-selected-row', Number(rowEl.dataset.rowIndex) === rowIndex);
        });

        Array.from(container.querySelectorAll('.attribute-grid-cell')).forEach((cellEl) => {
            const matchesRow = Number(cellEl.dataset.rowIndex) === rowIndex;
            const matchesColumn = cellEl.dataset.columnKey === columnKey;
            cellEl.classList.toggle('is-selected-cell', matchesRow && matchesColumn);
        });
    };

    Array.from(container.querySelectorAll('.attribute-grid-input')).forEach((input) => {
        input.addEventListener('focus', () => {
            syncGridSelection(Number(input.dataset.rowIndex), input.dataset.columnKey || null);
        });

        input.addEventListener('click', () => {
            syncGridSelection(Number(input.dataset.rowIndex), input.dataset.columnKey || null);
        });

        input.addEventListener('change', () => {
            const rowIndex = Number(input.dataset.rowIndex);
            const columnKey = input.dataset.columnKey;
            const row = model.rows[rowIndex];
            const cell = row?.cells.find((candidate) => candidate.key === columnKey);
            if (!row || !cell) return;

            const didUpdate = updateAttributeFeatureProperty(activeInfo.id, rowIndex, columnKey, input.value, cell.rawValue);
            if (!didUpdate) return;

            syncGridSelection(rowIndex, columnKey);
            updateDataContent();
        });
    });
}

function renderAttributeView() {
    syncActiveAttributeLayer();

    const mobileContainer = document.getElementById('attributeContent');
    const mobileSelector = document.getElementById('attributeLayerSelect');
    const mobileSummary = document.getElementById('attributeSummary');
    const desktopContainer = document.getElementById('desktopAttributeContent');
    const desktopSelector = document.getElementById('desktopAttributeLayerSelect');
    const desktopSummary = document.getElementById('desktopAttributeSummary');
    const desktopToggleLabel = document.getElementById('desktopAttributeToggleLabel');

    const selectors = [mobileSelector, desktopSelector].filter(Boolean);
    const summaries = [mobileSummary, desktopSummary].filter(Boolean);
    const containers = [mobileContainer, desktopContainer].filter(Boolean);
    if (!selectors.length || !containers.length) return;

    const selectedInfos = getSelectedLayers().map((layer) => state.getLayerInfo(layer)).filter(Boolean);
    const candidateInfos = selectedInfos.length
        ? selectedInfos
        : tocLayers.map((layer) => state.getLayerInfo(layer)).filter(Boolean);

    if (!candidateInfos.length) {
        selectors.forEach((selector) => {
            selector.innerHTML = '';
            selector.disabled = true;
        });
        summaries.forEach((summary) => {
            summary.textContent = 'No layer selected';
        });
        if (desktopToggleLabel) desktopToggleLabel.textContent = 'Attributes';
        containers.forEach((container) => {
            container.innerHTML = '<div class="attribute-empty">Select a layer to inspect its attributes.</div>';
        });
        return;
    }

    const safeActiveId = candidateInfos.some((info) => info.id === activeAttributeLayerId)
        ? activeAttributeLayerId
        : candidateInfos[0].id;
    activeAttributeLayerId = safeActiveId;

    const optionMarkup = candidateInfos.map((info) => `
        <option value="${escapeHtml(info.id)}" ${info.id === safeActiveId ? 'selected' : ''}>${escapeHtml(info.displayName || info.id)}</option>
    `).join('');

    selectors.forEach((selector) => {
        selector.disabled = candidateInfos.length === 1;
        selector.innerHTML = optionMarkup;
        selector.value = safeActiveId;
    });

    const activeInfo = candidateInfos.find((info) => info.id === safeActiveId) || candidateInfos[0];
    const model = getAttributeModel(activeInfo, { maxRows: 25 });
    const featureCount = activeInfo.geometry?.featureCount || model.totalRows || 0;
    const summaryText = `${featureCount} feature${featureCount === 1 ? '' : 's'} · ${model.columns.length} field${model.columns.length === 1 ? '' : 's'}`;

    summaries.forEach((summary) => {
        summary.textContent = summaryText;
    });
    if (desktopToggleLabel) {
        desktopToggleLabel.textContent = featureCount ? `${featureCount} feature${featureCount === 1 ? '' : 's'}` : 'Attributes';
    }

    if (!model.totalRows) {
        containers.forEach((container) => {
            container.innerHTML = '<div class="attribute-empty">This layer does not have feature attributes to display yet.</div>';
        });
        return;
    }

    const desktopHead = model.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const desktopRows = model.rows.map((row) => {
        const isActiveRow = row.index === activeDesktopAttributeRow;
        return `
            <tr class="${isActiveRow ? 'is-selected-row' : ''}" data-row-index="${row.index}">
                <td class="attribute-row-index">${row.index + 1}</td>
                ${row.cells.map((cell) => {
                    const isActiveCell = isActiveRow && cell.key === activeDesktopAttributeCell;
                    return `
                        <td class="attribute-grid-cell ${isActiveCell ? 'is-selected-cell' : ''}" data-row-index="${row.index}" data-column-key="${escapeHtml(cell.key)}">
                            <input
                                class="attribute-grid-input"
                                type="text"
                                value="${escapeHtml(cell.editValue)}"
                                data-row-index="${row.index}"
                                data-column-key="${escapeHtml(cell.key)}"
                                aria-label="Edit ${escapeHtml(cell.key)} for row ${row.index + 1}"
                            />
                        </td>
                    `;
                }).join('')}
                <td class="attribute-row-action"><button type="button" class="attribute-row-button" data-feature-index="${row.index}">Zoom</button></td>
            </tr>
        `;
    }).join('');

    const mobileCards = model.rows.map((row) => `
        <article class="attribute-card">
            <div class="attribute-card-header">
                <div>
                    <div class="attribute-card-title">${escapeHtml(row.title)}</div>
                    <div class="attribute-card-meta">${escapeHtml(row.geometryType)} · Row ${row.index + 1}</div>
                </div>
                <button type="button" class="attribute-row-button" data-feature-index="${row.index}">Zoom</button>
            </div>
            <dl class="attribute-card-list">
                ${row.cells.map((cell) => `<div><dt>${escapeHtml(cell.key)}</dt><dd>${escapeHtml(cell.value)}</dd></div>`).join('')}
            </dl>
        </article>
    `).join('');

    if (desktopContainer) {
        desktopContainer.innerHTML = `
            <div class="attribute-shell attribute-shell-desktop">
                <div class="attribute-table-wrap attribute-table-wrap-desktop">
                    <table class="attribute-table attribute-table-desktop">
                        <thead>
                            <tr>
                                <th>#</th>
                                ${desktopHead}
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>${desktopRows}</tbody>
                    </table>
                </div>
                ${model.hasMoreRows ? `<div class="attribute-footnote">Showing first ${model.visibleRows} of ${model.totalRows} features for speed.</div>` : ''}
            </div>
        `;
        wireAttributeZoomButtons(desktopContainer, model);
        wireDesktopAttributeGrid(desktopContainer, activeInfo, model);
    }

    if (mobileContainer) {
        mobileContainer.innerHTML = `
            <div class="attribute-shell">
                <div class="attribute-cards">${mobileCards}</div>
                ${model.hasMoreRows ? `<div class="attribute-footnote">Showing first ${model.visibleRows} of ${model.totalRows} features for speed.</div>` : ''}
            </div>
        `;
        wireAttributeZoomButtons(mobileContainer, model);
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
        item.tabIndex = 0;
        item.setAttribute('aria-label', `Layer ${getLayerLabel(layer, info?.label)}`);

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
            if (checkbox.checked) {
                selectedLayerIds.add(stableId);
                activeAttributeLayerId = stableId;
            } else {
                selectedLayerIds.delete(stableId);
                if (activeAttributeLayerId === stableId) activeAttributeLayerId = null;
            }
            renderToc();
            updateSelectionSummary();
            renderAttributeView();
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
        actionList.appendChild(createActionButton('fas fa-table', 'View attributes', () => {
            closeLayerMenu();
            selectedLayerIds.add(stableId);
            activeAttributeLayerId = stableId;
            renderToc();
            updateSelectionSummary();
            renderAttributeView();
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
            if (selectedLayerIds.has(stableId)) {
                selectedLayerIds.delete(stableId);
                if (activeAttributeLayerId === stableId) activeAttributeLayerId = null;
            } else {
                selectedLayerIds.add(stableId);
                activeAttributeLayerId = stableId;
            }
            renderToc();
            updateSelectionSummary();
            renderAttributeView();
        });

        item.addEventListener('keydown', (event) => {
            if (event.target !== item) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (selectedLayerIds.has(stableId)) {
                selectedLayerIds.delete(stableId);
                if (activeAttributeLayerId === stableId) activeAttributeLayerId = null;
            } else {
                selectedLayerIds.add(stableId);
                activeAttributeLayerId = stableId;
            }
            renderToc();
            updateSelectionSummary();
            renderAttributeView();
        });

        tocContent.appendChild(item);
    });
}

function refreshSidebarState() {
    renderToc();
    updateSelectionSummary();
    renderAttributeView();
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
            if (activeAttributeLayerId === layer.__id) activeAttributeLayerId = null;
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

    const handleAttributeLayerChange = (event) => {
        activeAttributeLayerId = event.target.value || null;
        renderAttributeView();
    };

    const attributeLayerSelect = document.getElementById('attributeLayerSelect');
    if (attributeLayerSelect) {
        attributeLayerSelect.addEventListener('change', handleAttributeLayerChange);
    }

    const desktopAttributeLayerSelect = document.getElementById('desktopAttributeLayerSelect');
    if (desktopAttributeLayerSelect) {
        desktopAttributeLayerSelect.addEventListener('change', handleAttributeLayerChange);
    }

    const desktopAttributeDrawer = document.getElementById('desktopAttributeDrawer');
    const desktopAttributeDrawerToggle = document.getElementById('desktopAttributeDrawerToggle');
    initializeDesktopAttributeDrawer(desktopAttributeDrawer, desktopAttributeDrawerToggle, map, {
        defaultOpen: false,
    });

    updateSelectionSummary();
    renderImportSummary(null);
    renderAttributeView();
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
