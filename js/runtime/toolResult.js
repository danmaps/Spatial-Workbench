function artifactFromDownload(download) {
  if (!download || typeof download !== 'object') return null;
  return {
    type: 'download',
    filename: download.filename || 'download.json',
    mimeType: download.mimeType || 'application/json',
    data: download.data === undefined ? '' : download.data,
  };
}

function outputFromLegacyResult(result = {}) {
  if (Array.isArray(result.outputs)) return result.outputs;

  const outputs = [];
  if (result.state?.featureCollection) {
    outputs.push({
      type: 'featureCollection',
      geojson: result.state.featureCollection,
      layerIds: [],
      metadata: {},
    });
  }
  if (Array.isArray(result.added) || Array.isArray(result.removed)) {
    outputs.push({
      type: 'layer',
      geojson: null,
      layerIds: Array.isArray(result.added) ? result.added : [],
      metadata: { removedLayerIds: Array.isArray(result.removed) ? result.removed : [] },
    });
  }
  return outputs;
}

function normalizeToolResult(result, status, { validation = null, state = null } = {}) {
  const legacy = result && typeof result === 'object' ? result : {};
  const artifacts = Array.isArray(legacy.artifacts)
    ? legacy.artifacts
    : [artifactFromDownload(legacy.download)].filter(Boolean);
  const normalizedStatus = legacy.status || status || { code: 0, message: 'ok' };

  return {
    ...legacy,
    ok: legacy.ok !== undefined ? legacy.ok : normalizedStatus.code === 0,
    status: normalizedStatus,
    outputs: outputFromLegacyResult(legacy),
    artifacts,
    logs: Array.isArray(legacy.logs) ? legacy.logs : [],
    ...(validation ? { validation } : {}),
    ...(state && !legacy.state ? { state } : {}),
  };
}

module.exports = {
  artifactFromDownload,
  normalizeToolResult,
};
