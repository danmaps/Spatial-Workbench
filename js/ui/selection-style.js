function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getLayerSelectionVisualState(options = {}) {
  const isSelected = Boolean(options.isSelected);
  const isActive = Boolean(options.isActive);

  if (isActive) {
    return {
      tone: 'active',
      tocClasses: ['is-selected', 'is-active'],
      label: 'Active',
    };
  }

  if (isSelected) {
    return {
      tone: 'selected',
      tocClasses: ['is-selected'],
      label: 'Selected',
    };
  }

  return {
    tone: 'idle',
    tocClasses: [],
    label: '',
  };
}

function getFeatureHighlightStyle(options = {}) {
  const geometryType = options.geometryType || 'Geometry';
  const isActive = Boolean(options.isActive);

  const accent = isActive ? '#7dd3fc' : '#4fb3ff';
  const accentSoft = isActive ? 'rgba(125, 211, 252, 0.22)' : 'rgba(79, 179, 255, 0.18)';

  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    return {
      kind: 'point',
      radius: isActive ? 12 : 10,
      weight: isActive ? 3 : 2,
      color: accent,
      fillColor: accent,
      fillOpacity: isActive ? 0.18 : 0.12,
      opacity: 0.95,
      pane: 'markerPane',
      interactive: false,
      bubblingMouseEvents: false,
    };
  }

  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    return {
      kind: 'line',
      color: accent,
      weight: isActive ? 8 : 6,
      opacity: isActive ? 0.78 : 0.66,
      lineCap: 'round',
      lineJoin: 'round',
      pane: 'overlayPane',
      interactive: false,
      bubblingMouseEvents: false,
    };
  }

  return {
    kind: 'area',
    color: accent,
    weight: isActive ? 3 : 2,
    opacity: 0.95,
    fillColor: accent,
    fillOpacity: isActive ? 0.2 : 0.14,
    pane: 'overlayPane',
    interactive: false,
    bubblingMouseEvents: false,
    className: 'selection-highlight-polygon',
    dashArray: isActive ? null : '4 4',
  };
}

function getLayerSelectionFeatureIds(options = {}) {
  const featureIds = Array.isArray(options.featureIds) ? options.featureIds.filter(Boolean) : [];
  const total = clamp(Number(options.totalFeatureCount) || 0, 0, Number.MAX_SAFE_INTEGER);
  const selected = featureIds.length;

  return {
    count: selected,
    total,
    summary: selected ? `${selected} selected` : '',
  };
}

module.exports = {
  getLayerSelectionVisualState,
  getFeatureHighlightStyle,
  getLayerSelectionFeatureIds,
};
