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

const COMPARISON_ROLE_STYLES = Object.freeze({
  intersection: Object.freeze({
    role: 'intersection',
    label: 'Overlap (A ∩ B)',
    shortLabel: 'A ∩ B',
    color: '#38bdf8',
    fillColor: '#38bdf8',
    fillOpacity: 0.35,
    weight: 2.5,
    opacity: 0.95,
    dashArray: null,
  }),
  'only-in-a': Object.freeze({
    role: 'only-in-a',
    label: 'Only in A (A - B)',
    shortLabel: 'A - B',
    color: '#f59e0b',
    fillColor: '#f59e0b',
    fillOpacity: 0.28,
    weight: 2,
    opacity: 0.9,
    dashArray: '5 4',
  }),
  'only-in-b': Object.freeze({
    role: 'only-in-b',
    label: 'Only in B (B - A)',
    shortLabel: 'B - A',
    color: '#ec4899',
    fillColor: '#ec4899',
    fillOpacity: 0.28,
    weight: 2,
    opacity: 0.9,
    dashArray: '2 4',
  }),
});

function getComparisonFeatureStyle(featureOrRole) {
  const role = typeof featureOrRole === 'string'
    ? featureOrRole
    : featureOrRole?.properties?.comparisonRole || null;
  if (!role || !Object.prototype.hasOwnProperty.call(COMPARISON_ROLE_STYLES, role)) {
    return null;
  }
  const style = COMPARISON_ROLE_STYLES[role];
  return {
    color: style.color,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    weight: style.weight,
    opacity: style.opacity,
    ...(style.dashArray ? { dashArray: style.dashArray } : {}),
  };
}

function getComparisonSummaryMeta(comparison) {
  if (!comparison || typeof comparison !== 'object') return null;
  const jaccard = Number(comparison.jaccardSimilarity) || 0;
  const overlapPctValue = (jaccard * 100).toFixed(1);
  const deltaNum = Number(comparison.areaDeltaSqm) || 0;
  const deltaSign = deltaNum >= 0 ? '+' : '';
  const counts = comparison.componentCounts || {};

  const legendItems = [
    {
      ...COMPARISON_ROLE_STYLES.intersection,
      present: counts.intersection !== undefined ? Boolean(counts.intersection) : (Number(comparison.intersectionAreaSqm) > 0),
      areaSqm: Number(comparison.intersectionAreaSqm) || 0,
    },
    {
      ...COMPARISON_ROLE_STYLES['only-in-a'],
      present: counts.onlyInA !== undefined ? Boolean(counts.onlyInA) : (Number(comparison.onlyInAAreaSqm) > 0),
      areaSqm: Number(comparison.onlyInAAreaSqm) || 0,
    },
    {
      ...COMPARISON_ROLE_STYLES['only-in-b'],
      present: counts.onlyInB !== undefined ? Boolean(counts.onlyInB) : (Number(comparison.onlyInBAreaSqm) > 0),
      areaSqm: Number(comparison.onlyInBAreaSqm) || 0,
    },
  ];

  return {
    layerAId: comparison.layerAId || 'Layer A',
    layerBId: comparison.layerBId || 'Layer B',
    areaASqm: Number(comparison.areaASqm) || 0,
    areaBSqm: Number(comparison.areaBSqm) || 0,
    intersectionAreaSqm: Number(comparison.intersectionAreaSqm) || 0,
    onlyInAAreaSqm: Number(comparison.onlyInAAreaSqm) || 0,
    onlyInBAreaSqm: Number(comparison.onlyInBAreaSqm) || 0,
    areaDeltaSqm: deltaNum,
    jaccardSimilarity: jaccard,
    overlapBadgeText: `${overlapPctValue}% overlap`,
    deltaBadgeText: `Δ ${deltaSign}${deltaNum} m²`,
    legendItems,
  };
}

module.exports = {
  COMPARISON_ROLE_STYLES,
  getComparisonFeatureStyle,
  getComparisonSummaryMeta,
  getLayerSelectionVisualState,
  getFeatureHighlightStyle,
  getLayerSelectionFeatureIds,
};
