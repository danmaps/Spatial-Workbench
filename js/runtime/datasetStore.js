const crypto = require('crypto');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function formatDatasetRef(id) {
  return `dataset://${id}`;
}

function parseDatasetRef(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('dataset://') ? trimmed.slice('dataset://'.length) : trimmed;
}

function createDatasetStoreError(message, { statusCode = 400, code = 'dataset-error', datasetRef } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code, ...(datasetRef ? { datasetRef } : {}) };
  return error;
}

function createInMemoryDatasetStore({ now = () => Date.now(), defaultTtlMs = 15 * 60 * 1000 } = {}) {
  const datasets = new Map();

  function cleanupExpiredDatasets() {
    const expired = [];
    const nowMs = now();
    datasets.forEach((record, id) => {
      if (record.expiresAt <= nowMs) {
        datasets.delete(id);
        expired.push(formatDatasetRef(id));
      }
    });
    return expired;
  }

  function getRecord(id, datasetRef) {
    const record = datasets.get(id);
    if (!record) {
      throw createDatasetStoreError('Dataset handle was not found.', {
        statusCode: 404,
        code: 'dataset-not-found',
        datasetRef,
      });
    }
    if (record.expiresAt <= now()) {
      datasets.delete(id);
      throw createDatasetStoreError('Dataset handle has expired.', {
        statusCode: 410,
        code: 'dataset-expired',
        datasetRef,
      });
    }
    return record;
  }

  function assertOwner(record, ownerId, datasetRef) {
    if (record.ownerId !== ownerId) {
      throw createDatasetStoreError('Dataset handle is not available for this caller.', {
        statusCode: 403,
        code: 'dataset-access-denied',
        datasetRef,
      });
    }
  }

  function registerDataset({ ownerId, geojson, ttlMs = defaultTtlMs, name = null }) {
    const parsedTtlMs = Number(ttlMs);
    if (!Number.isFinite(parsedTtlMs) || parsedTtlMs <= 0) {
      throw createDatasetStoreError('Dataset ttlMs must be a positive number.', {
        statusCode: 400,
        code: 'dataset-ttl-invalid',
      });
    }

    const id = crypto.randomBytes(12).toString('hex');
    const createdAt = now();
    const expiresAt = createdAt + parsedTtlMs;
    datasets.set(id, {
      id,
      ownerId,
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      geojson: deepClone(geojson),
      createdAt,
      expiresAt,
    });

    return {
      id,
      datasetRef: formatDatasetRef(id),
      ownerId,
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      ttlMs: parsedTtlMs,
    };
  }

  function getDataset({ datasetRef, ownerId, includeData = false }) {
    const id = parseDatasetRef(datasetRef);
    if (!id) {
      throw createDatasetStoreError('datasetRef is required.', {
        statusCode: 400,
        code: 'dataset-ref-invalid',
      });
    }

    const canonicalRef = formatDatasetRef(id);
    const record = getRecord(id, canonicalRef);
    assertOwner(record, ownerId, canonicalRef);
    return {
      id: record.id,
      datasetRef: canonicalRef,
      ownerId: record.ownerId,
      name: record.name,
      createdAt: new Date(record.createdAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
      ...(includeData ? { geojson: deepClone(record.geojson) } : {}),
    };
  }

  function resolveDatasetReference({ datasetRef, ownerId }) {
    const dataset = getDataset({ datasetRef, ownerId, includeData: true });
    return {
      id: dataset.id,
      datasetRef: dataset.datasetRef,
      geojson: dataset.geojson,
    };
  }

  function deleteDataset({ datasetRef, ownerId }) {
    const id = parseDatasetRef(datasetRef);
    if (!id) {
      throw createDatasetStoreError('datasetRef is required.', {
        statusCode: 400,
        code: 'dataset-ref-invalid',
      });
    }
    const canonicalRef = formatDatasetRef(id);
    const record = getRecord(id, canonicalRef);
    assertOwner(record, ownerId, canonicalRef);
    datasets.delete(id);
    return {
      id: record.id,
      datasetRef: canonicalRef,
    };
  }

  return {
    registerDataset,
    getDataset,
    resolveDatasetReference,
    deleteDataset,
    cleanupExpiredDatasets,
  };
}

module.exports = {
  createInMemoryDatasetStore,
  createDatasetStoreError,
  formatDatasetRef,
  parseDatasetRef,
};
