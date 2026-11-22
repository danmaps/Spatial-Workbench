const { createComponentEvent } = require('./contracts');

const LIFECYCLE_LABELS = Object.freeze({
  loading: { label: 'Streaming…', tone: 'muted' },
  empty: { label: 'Empty', tone: 'muted' },
  draft: { label: 'Draft', tone: 'neutral' },
  invalid: { label: 'Needs attention', tone: 'danger' },
  running: { label: 'Running…', tone: 'info' },
  partial: { label: 'Completed with warnings', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLifecycleMeta(lifecycle) {
  return LIFECYCLE_LABELS[lifecycle] || LIFECYCLE_LABELS.draft;
}

function emitComponentEvent(targetElement, options, eventSpec) {
  const event = createComponentEvent(eventSpec);
  if (typeof options?.onEvent === 'function') {
    options.onEvent(event);
  }
  if (targetElement && typeof targetElement.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    targetElement.dispatchEvent(
      new CustomEvent(event.eventType, {
        bubbles: true,
        detail: event,
      })
    );
  }
  return event;
}

function renderLifecycleBadge(model) {
  const meta = getLifecycleMeta(model.lifecycle);
  return `<span class="swb-badge swb-badge-${escapeHtml(meta.tone)}" data-lifecycle="${escapeHtml(model.lifecycle)}">${escapeHtml(meta.label)}</span>`;
}

function renderValidationErrors(validation) {
  const errors = Array.isArray(validation?.errors) ? validation.errors.filter(Boolean) : [];
  if (!errors.length) return '';
  return `
    <div class="swb-validation-banner" role="alert" aria-live="polite">
      <strong class="swb-validation-title">Validation required:</strong>
      <ul class="swb-validation-list">
        ${errors.map((err) => `<li>${escapeHtml(err)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderFallbackComponent(container, model) {
  const section = document.createElement('section');
  section.className = 'swb-component swb-fallback-component';
  section.dataset.componentType = 'FallbackComponent';
  section.dataset.componentId = model.componentId;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', `Unsupported component ${model.requestedType}`);

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Component Fallback</span>
        <h3 class="swb-component-title">${escapeHtml(model.requestedType || 'Unknown Component')}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-fallback-body" role="alert">
      <p>${escapeHtml(model.reason)}</p>
      <p class="swb-meta-note">Contract version: <code>${escapeHtml(model.requestedVersion)}</code></p>
    </div>
  `;

  if (container) container.appendChild(section);
  return section;
}

function renderLayerInput(container, model, options = {}) {
  const section = document.createElement('section');
  section.className = 'swb-component swb-layer-input';
  section.dataset.componentType = 'LayerInput';
  section.dataset.componentId = model.componentId;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', `Layer input for ${model.parameterName}`);

  const selectId = `${model.componentId}-layer-select`;
  const scopeLayerId = `${model.componentId}-scope-layer`;
  const scopeSelectionId = `${model.componentId}-scope-selection`;
  const isDisabled = !model.streamComplete || model.lifecycle === 'running' || model.candidates.length === 0;
  const geometryConstraintText = model.allowedGeometryTypes.length
    ? `Accepts: ${model.allowedGeometryTypes.join(', ')}`
    : 'Accepts any geometry';

  const optionsHtml = model.candidates.length
    ? model.candidates
        .map((candidate) => {
          const compatSuffix = candidate.compatible ? '' : ' (incompatible geometry)';
          const selectedAttr = candidate.id === model.result.layerId ? 'selected' : '';
          return `<option value="${escapeHtml(candidate.id)}" ${selectedAttr}>${escapeHtml(candidate.displayName)} · ${escapeHtml(candidate.primaryGeometryType)} (${candidate.featureCount})${escapeHtml(compatSuffix)}</option>`;
        })
        .join('')
    : '<option value="">No layers available</option>';

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Input Layer</span>
        <h3 class="swb-component-title">${escapeHtml(model.parameterName)}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-component-body">
      <div class="swb-field-group">
        <label class="swb-label" for="${escapeHtml(selectId)}">Source layer</label>
        <select
          id="${escapeHtml(selectId)}"
          class="swb-select"
          ${isDisabled ? 'disabled aria-disabled="true"' : ''}
          aria-invalid="${model.validation.ok ? 'false' : 'true'}"
        >
          ${optionsHtml}
        </select>
        <div class="swb-field-hint">${escapeHtml(geometryConstraintText)}</div>
      </div>
      ${
        model.selectionAware
          ? `
        <fieldset class="swb-scope-fieldset" ${!model.streamComplete ? 'disabled' : ''}>
          <legend class="swb-label">Analysis scope</legend>
          <div class="swb-scope-options">
            <label class="swb-radio-label" for="${escapeHtml(scopeLayerId)}">
              <input
                type="radio"
                id="${escapeHtml(scopeLayerId)}"
                name="${escapeHtml(model.componentId)}-scope"
                value="layer"
                ${model.result.targetScope === 'layer' ? 'checked' : ''}
              />
              <span>Whole layer (${model.result.featureCount})</span>
            </label>
            <label class="swb-radio-label" for="${escapeHtml(scopeSelectionId)}">
              <input
                type="radio"
                id="${escapeHtml(scopeSelectionId)}"
                name="${escapeHtml(model.componentId)}-scope"
                value="selection"
                ${model.result.targetScope === 'selection' ? 'checked' : ''}
              />
              <span>Selected features (${model.result.selectedFeatureCount})</span>
            </label>
          </div>
        </fieldset>
      `
          : ''
      }
      ${renderValidationErrors(model.validation)}
    </div>
  `;

  const selectEl = section.querySelector('select.swb-select');
  const radioEls = Array.from(section.querySelectorAll('input[type="radio"]'));

  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      emitComponentEvent(section, options, {
        eventType: 'swb:layer-selected',
        componentId: model.componentId,
        stateRevision: model.stateRevision,
        payload: {
          toolKey: model.toolKey,
          parameterName: model.parameterName,
          layerId: e.target.value,
          targetScope: model.result.targetScope,
        },
      });
    });
  }

  radioEls.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (!e.target.checked) return;
      emitComponentEvent(section, options, {
        eventType: 'swb:layer-selected',
        componentId: model.componentId,
        stateRevision: model.stateRevision,
        payload: {
          toolKey: model.toolKey,
          parameterName: model.parameterName,
          layerId: selectEl ? selectEl.value : model.result.layerId,
          targetScope: e.target.value,
        },
      });
    });
  });

  if (container) container.appendChild(section);
  return section;
}

function renderSpatialSelection(container, model, options = {}) {
  const section = document.createElement('section');
  section.className = 'swb-component swb-spatial-selection';
  section.dataset.componentType = 'SpatialSelection';
  section.dataset.componentId = model.componentId;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', `Spatial selection for ${model.layerName}`);

  const summaryText = model.mode === 'selected_features'
    ? `${model.result.selectedFeatureIds.length} of ${model.result.totalFeatureCount} feature(s) selected`
    : `Whole layer active (${model.result.totalFeatureCount} feature(s))`;

  const itemsHtml = model.items.length
    ? model.items
        .map((item) => {
          const checkboxId = `${model.componentId}-feat-${item.id}`;
          return `
            <li class="swb-selection-item ${item.selected ? 'is-selected' : ''}">
              <label class="swb-checkbox-label" for="${escapeHtml(checkboxId)}">
                <input
                  type="checkbox"
                  id="${escapeHtml(checkboxId)}"
                  class="swb-feature-checkbox"
                  data-feature-id="${escapeHtml(item.id)}"
                  ${item.selected ? 'checked' : ''}
                  ${!model.streamComplete ? 'disabled' : ''}
                />
                <span class="swb-feature-title">${escapeHtml(item.title)}</span>
                <span class="swb-feature-meta">${escapeHtml(item.geometryType)} · <code>${escapeHtml(item.id)}</code></span>
              </label>
            </li>
          `;
        })
        .join('')
    : '<li class="swb-empty-note">No features in this layer.</li>';

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Spatial Selection</span>
        <h3 class="swb-component-title">${escapeHtml(model.layerName)}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-component-body">
      <div class="swb-selection-toolbar">
        <span class="swb-selection-summary" aria-live="polite">${escapeHtml(summaryText)}</span>
        <div class="swb-selection-actions">
          <button type="button" class="swb-btn swb-btn-ghost" data-selection-action="all" ${!model.streamComplete || !model.items.length ? 'disabled' : ''}>Select all</button>
          <button type="button" class="swb-btn swb-btn-ghost" data-selection-action="clear" ${!model.streamComplete || !model.result.selectedFeatureIds.length ? 'disabled' : ''}>Clear</button>
        </div>
      </div>
      <ul class="swb-selection-list" aria-label="Selectable features">
        ${itemsHtml}
      </ul>
      ${renderValidationErrors(model.validation)}
    </div>
  `;

  const checkboxes = Array.from(section.querySelectorAll('.swb-feature-checkbox'));
  const emitSelection = (nextIds, nextScope) => {
    emitComponentEvent(section, options, {
      eventType: 'swb:selection-changed',
      componentId: model.componentId,
      stateRevision: model.stateRevision,
      payload: {
        layerId: model.layerId,
        selectedFeatureIds: nextIds,
        targetScope: nextScope || (model.mode === 'selected_features' ? 'selection' : 'layer'),
      },
    });
  };

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const checkedIds = checkboxes
        .filter((cb) => cb.checked)
        .map((cb) => cb.dataset.featureId);
      emitSelection(checkedIds);
    });
  });

  const selectAllBtn = section.querySelector('[data-selection-action="all"]');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      emitSelection(model.items.map((item) => item.id), 'selection');
    });
  }

  const clearBtn = section.querySelector('[data-selection-action="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      emitSelection([], model.mode === 'selected_features' ? 'selection' : 'layer');
    });
  }

  if (container) container.appendChild(section);
  return section;
}

function renderParameterFieldControl(componentId, field, streamComplete) {
  const inputId = `${componentId}-param-${field.name.replace(/\s+/g, '-')}`;
  const disabledAttr = !streamComplete || field.locked ? 'disabled aria-disabled="true"' : '';
  const requiredBadge = field.required ? '<span class="swb-required-indicator" aria-hidden="true">*</span>' : '';
  const unitHint = field.unit ? `<span class="swb-unit-tag">${escapeHtml(field.unit)}</span>` : '';

  let controlHtml = '';
  if (field.type === 'dropdown') {
    const options = Array.isArray(field.options) && field.options.length
      ? field.options
      : (field.value ? [field.value] : []);
    controlHtml = `
      <select
        id="${escapeHtml(inputId)}"
        class="swb-select swb-param-input"
        data-param-name="${escapeHtml(field.name)}"
        data-param-type="${escapeHtml(field.type)}"
        ${field.required ? 'required aria-required="true"' : ''}
        ${disabledAttr}
      >
        ${options
          .map(
            (opt) =>
              `<option value="${escapeHtml(opt)}" ${String(opt).toLowerCase() === String(field.value).toLowerCase() ? 'selected' : ''}>${escapeHtml(opt)}</option>`
          )
          .join('')}
      </select>
    `;
  } else if (field.type === 'boolean') {
    controlHtml = `
      <input
        type="checkbox"
        id="${escapeHtml(inputId)}"
        class="swb-checkbox swb-param-input"
        data-param-name="${escapeHtml(field.name)}"
        data-param-type="boolean"
        ${field.value ? 'checked' : ''}
        ${disabledAttr}
      />
    `;
  } else if (field.type === 'int' || field.type === 'float') {
    const displayValue = Number.isFinite(field.value) ? String(field.value) : '';
    const step = field.type === 'int' ? '1' : 'any';
    const minAttr = field.min !== null && field.min !== undefined ? `min="${escapeHtml(field.min)}"` : '';
    const maxAttr = field.max !== null && field.max !== undefined ? `max="${escapeHtml(field.max)}"` : '';
    controlHtml = `
      <input
        type="number"
        id="${escapeHtml(inputId)}"
        class="swb-input swb-param-input"
        data-param-name="${escapeHtml(field.name)}"
        data-param-type="${escapeHtml(field.type)}"
        value="${escapeHtml(displayValue)}"
        step="${step}"
        ${minAttr}
        ${maxAttr}
        ${field.required ? 'required aria-required="true"' : ''}
        ${disabledAttr}
      />
    `;
  } else {
    controlHtml = `
      <input
        type="text"
        id="${escapeHtml(inputId)}"
        class="swb-input swb-param-input"
        data-param-name="${escapeHtml(field.name)}"
        data-param-type="text"
        value="${escapeHtml(field.value ?? '')}"
        ${field.required ? 'required aria-required="true"' : ''}
        ${disabledAttr}
      />
    `;
  }

  return `
    <div class="swb-field-group" data-field-name="${escapeHtml(field.name)}">
      <label class="swb-label" for="${escapeHtml(inputId)}">
        <span>${escapeHtml(field.name)}</span>
        ${requiredBadge}
        ${unitHint}
      </label>
      ${controlHtml}
      ${field.description ? `<div class="swb-field-hint">${escapeHtml(field.description)}</div>` : ''}
    </div>
  `;
}

function renderToolParameters(container, model, options = {}) {
  const section = document.createElement('section');
  section.className = 'swb-component swb-tool-parameters';
  section.dataset.componentType = 'ToolParameters';
  section.dataset.componentId = model.componentId;
  section.dataset.toolKey = model.toolKey;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', `${model.toolName} parameters`);

  const visibleFields = model.fields.filter((field) => !field.locked);
  const fieldsHtml = visibleFields
    .map((field) => renderParameterFieldControl(model.componentId, field, model.streamComplete))
    .join('');

  const assumptionsHtml = model.spatialAssumptions
    ? `
      <div class="swb-assumptions-bar" aria-label="Spatial measurement assumptions">
        <span><strong>CRS:</strong> <code>${escapeHtml(model.spatialAssumptions.crs)}</code> (${escapeHtml(model.spatialAssumptions.coordinateOrder)})</span>
        <span><strong>Engine:</strong> <code>${escapeHtml(model.spatialAssumptions.engine)}</code> (${escapeHtml(model.spatialAssumptions.precision)})</span>
      </div>
    `
    : '';

  const buttonLabel = options.executeLabel || `Run ${model.toolName}`;

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Tool Parameters · <code>${escapeHtml(model.toolKey)}</code></span>
        <h3 class="swb-component-title">${escapeHtml(model.toolName)}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-component-body">
      ${model.description ? `<p class="swb-component-description">${escapeHtml(model.description)}</p>` : ''}
      <form class="swb-params-form" novalidate>
        ${fieldsHtml}
        ${assumptionsHtml}
        ${renderValidationErrors(model.validation)}
        <div class="swb-form-actions">
          <button
            type="submit"
            class="swb-btn swb-btn-primary swb-execute-btn"
            ${model.canExecute ? 'aria-disabled="false"' : 'disabled aria-disabled="true"'}
          >
            ${escapeHtml(buttonLabel)}
          </button>
          <span class="swb-revision-tag">Rev #${model.stateRevision}</span>
        </div>
      </form>
    </div>
  `;

  const collectDraftValues = () => {
    const draft = {};
    Array.from(section.querySelectorAll('.swb-param-input')).forEach((el) => {
      const name = el.dataset.paramName;
      const type = el.dataset.paramType;
      if (!name) return;
      if (type === 'boolean') {
        draft[name] = Boolean(el.checked);
      } else if (type === 'int') {
        const trimmed = String(el.value ?? '').trim();
        draft[name] = trimmed === '' ? '' : parseInt(trimmed, 10);
      } else if (type === 'float') {
        const trimmed = String(el.value ?? '').trim();
        draft[name] = trimmed === '' ? '' : parseFloat(trimmed);
      } else {
        draft[name] = el.value;
      }
    });
    return draft;
  };

  Array.from(section.querySelectorAll('.swb-param-input')).forEach((inputEl) => {
    const handler = () => {
      emitComponentEvent(section, options, {
        eventType: 'swb:params-draft-changed',
        componentId: model.componentId,
        stateRevision: model.stateRevision,
        payload: {
          toolKey: model.toolKey,
          params: collectDraftValues(),
        },
      });
    };
    inputEl.addEventListener('change', handler);
  });

  const formEl = section.querySelector('.swb-params-form');
  if (formEl) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!model.canExecute) return;
      emitComponentEvent(section, options, {
        eventType: 'swb:execute-requested',
        componentId: model.componentId,
        stateRevision: model.stateRevision,
        payload: {
          toolKey: model.toolKey,
          params: {
            ...model.result.params,
            ...collectDraftValues(),
          },
        },
      });
    });
  }

  if (container) container.appendChild(section);
  return section;
}

function mountLeafletPreview(mapHost, model, options = {}) {
  const L = options.leaflet || (typeof globalThis !== 'undefined' ? globalThis.L : null);
  if (!L || typeof L.map !== 'function' || typeof L.geoJSON !== 'function') {
    return false;
  }

  try {
    mapHost.innerHTML = '';
    const mapCanvas = document.createElement('div');
    mapCanvas.className = 'swb-leaflet-canvas';
    mapCanvas.style.minHeight = model.surfaceVariant === 'workspace' ? '320px' : '200px';
    mapHost.appendChild(mapCanvas);

    const map = L.map(mapCanvas, {
      attributionControl: false,
      zoomControl: true,
    }).setView([34.05, -118.245], 12);

    if (typeof L.tileLayer === 'function') {
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
      }).addTo(map);
    }

    const boundsList = [];
    model.visibleLayers.forEach((layer) => {
      if (!layer.geojson) return;
      const isPrimary = layer.isPrimaryOutput;
      const geoLayer = L.geoJSON(layer.geojson, {
        style: () => ({
          color: isPrimary ? '#38bdf8' : '#94a3b8',
          weight: isPrimary ? 2.5 : 1.5,
          dashArray: isPrimary ? null : '4 4',
          fillOpacity: isPrimary ? 0.28 : 0.1,
        }),
      }).addTo(map);
      if (typeof geoLayer.getBounds === 'function') {
        const b = geoLayer.getBounds();
        if (b && typeof b.isValid === 'function' && b.isValid()) {
          boundsList.push(b);
        }
      }
    });

    if (boundsList.length && typeof map.fitBounds === 'function') {
      const combined = boundsList.slice(1).reduce((acc, b) => acc.extend(b), boundsList[0]);
      map.fitBounds(combined, { padding: [20, 20] });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function renderSpatialResult(container, model, options = {}) {
  const section = document.createElement('section');
  section.className = `swb-component swb-spatial-result swb-variant-${model.surfaceVariant}`;
  section.dataset.componentType = 'SpatialResult';
  section.dataset.componentId = model.componentId;
  section.dataset.surfaceVariant = model.surfaceVariant;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', 'Spatial result and attributes');

  const attr = model.attributeModel;
  const layerBadgesHtml = model.visibleLayers.length
    ? model.visibleLayers
        .map((layer) => {
          const roleTag = layer.isPrimaryOutput ? 'Output' : (layer.isSourceLayer ? 'Source' : 'Layer');
          return `<span class="swb-layer-chip ${layer.isPrimaryOutput ? 'is-primary' : ''}" data-layer-id="${escapeHtml(layer.id)}"><strong>${escapeHtml(roleTag)}:</strong> ${escapeHtml(layer.displayName)} (${escapeHtml(layer.geometryType)})</span>`;
        })
        .join('')
    : '<span class="swb-empty-note">No visible layers</span>';

  const cardsHtml = attr.rows.length
    ? attr.rows
        .map(
          (row) => `
          <article class="attribute-card swb-attribute-card" data-feature-id="${escapeHtml(row.id)}">
            <div class="attribute-card-header">
              <div>
                <div class="attribute-card-title">${escapeHtml(row.title)}</div>
                <div class="attribute-card-meta">${escapeHtml(row.geometryType)} · <code>${escapeHtml(row.id)}</code></div>
              </div>
            </div>
            <dl class="attribute-card-list">
              ${row.cells.map((cell) => `<div><dt>${escapeHtml(cell.key)}</dt><dd>${escapeHtml(cell.value)}</dd></div>`).join('')}
            </dl>
          </article>
        `
        )
        .join('')
    : '<div class="swb-empty-note">No feature attributes available to display.</div>';

  const tableHtml = model.surfaceVariant === 'workspace' && attr.rows.length
    ? `
      <div class="swb-table-wrap">
        <table class="swb-attribute-table" aria-label="Output feature attributes">
          <thead>
            <tr>
              <th>#</th>
              <th>Feature ID</th>
              ${attr.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${attr.rows
              .map(
                (row) => `
                <tr data-feature-id="${escapeHtml(row.id)}">
                  <td>${row.index + 1}</td>
                  <td><code>${escapeHtml(row.id)}</code></td>
                  ${row.cells.map((cell) => `<td>${escapeHtml(cell.value)}</td>`).join('')}
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `
    : '';

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Spatial Result (${escapeHtml(model.surfaceVariant)})</span>
        <h3 class="swb-component-title">${escapeHtml(model.primaryLayer?.displayName || 'No Result Layer')}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-component-body">
      <div class="swb-layer-chip-bar" aria-label="Visible map layers">
        ${layerBadgesHtml}
      </div>
      <div class="swb-map-preview-host" role="img" aria-label="Geometry preview for ${escapeHtml(model.primaryLayer?.displayName || 'layers')}">
        <div class="swb-map-fallback-summary">
          <strong>Map Geometry Preview:</strong>
          <span>${model.visibleLayers.length} layer(s) mounted</span>
          ${model.sourceLayer ? `<span>· Preserved source: <code>${escapeHtml(model.sourceLayer.id)}</code></span>` : ''}
          ${model.primaryLayer ? `<span>· Active output: <code>${escapeHtml(model.primaryLayer.id)}</code> (${attr.totalRows} feature(s))</span>` : ''}
        </div>
      </div>
      <div class="swb-attribute-inspector">
        <div class="swb-attribute-header">
          <strong>Linked Attributes</strong>
          <span class="swb-meta-note">${attr.totalRows} feature(s) · ${attr.columns.length} field(s)</span>
        </div>
        ${tableHtml}
        <div class="swb-attribute-cards">${cardsHtml}</div>
      </div>
    </div>
  `;

  const mapHost = section.querySelector('.swb-map-preview-host');
  if (mapHost && options.enableLeafletMap !== false) {
    mountLeafletPreview(mapHost, model, options);
  }

  if (container) container.appendChild(section);
  return section;
}

function renderExecutionReceipt(container, model, options = {}) {
  const section = document.createElement('section');
  section.className = 'swb-component swb-execution-receipt';
  section.dataset.componentType = 'ExecutionReceipt';
  section.dataset.componentId = model.componentId;
  section.dataset.lifecycle = model.lifecycle;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', `Execution receipt for ${model.toolKey || 'tool'}`);

  if (!model.grounded) {
    section.innerHTML = `
      <header class="swb-component-header">
        <div>
          <span class="swb-eyebrow">Execution Receipt</span>
          <h3 class="swb-component-title">${escapeHtml(model.toolKey || 'Pending Execution')}</h3>
        </div>
        ${renderLifecycleBadge(model)}
      </header>
      <div class="swb-component-body">
        <p class="swb-empty-note">No execution has run yet. Proposals and draft parameters do not produce a receipt until explicitly executed.</p>
      </div>
    `;
    if (container) container.appendChild(section);
    return section;
  }

  const exec = model.execution || {};
  const target = exec.target || null;
  const targetDescription = target
    ? (target.mode === 'selection'
        ? `Selected features (${target.selectedFeatureCount} of ${target.totalFeatureCount} on ${target.layerId})`
        : `Whole layer (${target.totalFeatureCount} feature(s) on ${target.layerId || 'layer'})`)
    : 'Standard execution';

  const warningsHtml = model.spatial?.warnings?.length
    ? `
      <div class="swb-receipt-warnings" role="status" aria-live="polite">
        <strong>Spatial Warnings (${model.spatial.warnings.length})</strong>
        <ul>
          ${model.spatial.warnings
            .map((w) => `<li><code>${escapeHtml(w.code)}</code>: ${escapeHtml(w.message)}</li>`)
            .join('')}
        </ul>
      </div>
    `
    : '';

  const artifactsHtml = model.artifacts?.length
    ? `
      <div class="swb-receipt-artifacts">
        ${model.artifacts
          .map(
            (artifact, idx) => `
            <button
              type="button"
              class="swb-btn swb-btn-secondary swb-artifact-btn"
              data-artifact-index="${idx}"
              data-artifact-filename="${escapeHtml(artifact.filename)}"
            >
              Download ${escapeHtml(artifact.filename)}
            </button>
          `
          )
          .join('')}
      </div>
    `
    : '';

  section.innerHTML = `
    <header class="swb-component-header">
      <div>
        <span class="swb-eyebrow">Execution Receipt · Grounded</span>
        <h3 class="swb-component-title">${escapeHtml(model.toolKey)}</h3>
      </div>
      ${renderLifecycleBadge(model)}
    </header>
    <div class="swb-component-body">
      <p class="swb-receipt-status" aria-live="polite">${escapeHtml(model.status?.message || '')}</p>
      <dl class="swb-receipt-grid">
        <div>
          <dt>Duration</dt>
          <dd>${exec.durationMs ?? 0} ms</dd>
        </div>
        <div>
          <dt>Feature counts</dt>
          <dd>${exec.featureCounts?.input ?? 0} → ${exec.featureCounts?.output ?? 0}</dd>
        </div>
        <div>
          <dt>Target scope</dt>
          <dd>${escapeHtml(targetDescription)}</dd>
        </div>
        <div>
          <dt>Input / Output layers</dt>
          <dd><code>${escapeHtml((exec.inputLayerIds || []).join(', ') || 'none')}</code> → <code>${escapeHtml((exec.outputLayerIds || []).join(', ') || 'artifact')}</code></dd>
        </div>
        <div>
          <dt>Spatial assumptions</dt>
          <dd><code>${escapeHtml(model.spatial?.crs || 'EPSG:4326')}</code> · ${escapeHtml(model.spatial?.precision || 'not-survey-grade')}</dd>
        </div>
      </dl>
      ${warningsHtml}
      ${renderValidationErrors(model.validation && !model.result.ok ? model.validation : null)}
      ${artifactsHtml}
    </div>
  `;

  Array.from(section.querySelectorAll('.swb-artifact-btn')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.artifactIndex);
      const artifact = model.artifacts[idx];
      if (!artifact) return;
      emitComponentEvent(section, options, {
        eventType: 'swb:artifact-download',
        componentId: model.componentId,
        stateRevision: model.stateRevision,
        payload: {
          toolKey: model.toolKey,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          data: artifact.data,
        },
      });
    });
  });

  if (container) container.appendChild(section);
  return section;
}

function renderComponent(container, model, options = {}) {
  if (!model || typeof model !== 'object') return null;
  switch (model.type) {
    case 'LayerInput':
      return renderLayerInput(container, model, options);
    case 'SpatialSelection':
      return renderSpatialSelection(container, model, options);
    case 'ToolParameters':
      return renderToolParameters(container, model, options);
    case 'SpatialResult':
      return renderSpatialResult(container, model, options);
    case 'ExecutionReceipt':
      return renderExecutionReceipt(container, model, options);
    case 'FallbackComponent':
    default:
      return renderFallbackComponent(container, model, options);
  }
}

function renderComposition(container, resolvedComposition, options = {}) {
  if (!container) return null;
  container.innerHTML = '';

  const layout = resolvedComposition?.layout === 'workspace' ? 'workspace' : 'compact';
  const root = document.createElement('div');
  root.className = `swb-composition swb-layout-${layout}`;
  root.dataset.contractVersion = resolvedComposition?.contractVersion || 'swb.ui.v0';
  root.dataset.layout = layout;
  root.dataset.stateRevision = String(resolvedComposition?.stateRevision || 1);
  root.dataset.streamComplete = String(resolvedComposition?.streamComplete !== false);

  const components = Array.isArray(resolvedComposition?.components) ? resolvedComposition.components : [];

  if (layout === 'workspace') {
    const leftPane = document.createElement('div');
    leftPane.className = 'swb-workspace-pane swb-workspace-controls';
    const rightPane = document.createElement('div');
    rightPane.className = 'swb-workspace-pane swb-workspace-inspector';

    components.forEach((model) => {
      const targetPane = model.type === 'SpatialResult' ? rightPane : leftPane;
      renderComponent(targetPane, model, options);
    });

    root.appendChild(leftPane);
    root.appendChild(rightPane);
  } else {
    components.forEach((model) => {
      renderComponent(root, model, options);
    });
  }

  container.appendChild(root);
  return root;
}

module.exports = {
  renderLayerInput,
  renderSpatialSelection,
  renderToolParameters,
  renderSpatialResult,
  renderExecutionReceipt,
  renderFallbackComponent,
  renderComponent,
  renderComposition,
};
