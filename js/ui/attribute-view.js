function normalizeToFeatures(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features) ? geojson.features.filter(Boolean) : [];
  }
  if (geojson.type === 'Feature') return [geojson];
  return [];
}

function sortColumnNames(columns) {
  return Array.from(columns).sort((a, b) => {
    if (a === 'name') return -1;
    if (b === 'name') return 1;
    return a.localeCompare(b);
  });
}

function stringifyValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getAttributeModel(layerInfo, options = {}) {
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : 25;
  const geojson = layerInfo?.geojson || null;
  const features = normalizeToFeatures(geojson);
  const columns = new Set();

  features.forEach((feature) => {
    const properties = feature?.properties || {};
    Object.keys(properties).forEach((key) => {
      if (key === '__id') return;
      columns.add(key);
    });
  });

  const orderedColumns = sortColumnNames(columns);
  const rows = features.slice(0, maxRows).map((feature, index) => {
    const properties = feature?.properties || {};
    const cells = orderedColumns.map((column) => ({
      key: column,
      value: stringifyValue(properties[column]),
      rawValue: properties[column],
    }));

    return {
      id: properties.__id || `${layerInfo?.id || 'feature'}-${index + 1}`,
      index,
      feature,
      geometryType: feature?.geometry?.type || layerInfo?.geometry?.type || 'Unknown',
      title: stringifyValue(properties.name) !== '—'
        ? stringifyValue(properties.name)
        : `${layerInfo?.geometry?.label || 'Feature'} ${index + 1}`,
      cells,
      properties,
    };
  });

  return {
    columns: orderedColumns,
    rows,
    totalRows: features.length,
    visibleRows: rows.length,
    hasMoreRows: features.length > rows.length,
    hasAttributes: orderedColumns.length > 0,
  };
}

module.exports = {
  normalizeToFeatures,
  stringifyValue,
  getAttributeModel,
};
