const DEFAULT_MAX_ENTRIES = 25;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB memory budget for retained history

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hashString(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}-${str.length}`;
}

function createHistoryStack(options = {}) {
  const maxEntries = Math.max(2, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);

  // Content-addressed store for serialized layer GeoJSON strings: blobId -> string
  const blobStore = new Map();
  let entries = [];
  let index = -1;

  function internGeoJson(geojson) {
    const serialized = JSON.stringify(geojson);
    const baseHash = hashString(serialized);
    let candidateId = baseHash;
    let suffix = 0;
    while (blobStore.has(candidateId) && blobStore.get(candidateId) !== serialized) {
      suffix += 1;
      candidateId = `${baseHash}-${suffix}`;
    }
    if (!blobStore.has(candidateId)) {
      blobStore.set(candidateId, serialized);
    }
    return candidateId;
  }

  function compactSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.layers)) {
      return { compact: deepClone(snapshot), blobIds: [] };
    }
    const blobIds = [];
    const compactLayers = snapshot.layers.map((layer) => {
      if (!layer || typeof layer !== 'object' || !layer.geojson) {
        return deepClone(layer);
      }
      const { geojson, ...rest } = layer;
      const blobId = internGeoJson(geojson);
      blobIds.push(blobId);
      return {
        ...deepClone(rest),
        __geojsonBlobId: blobId,
      };
    });
    return {
      compact: {
        ...deepClone(snapshot),
        layers: compactLayers,
      },
      blobIds,
    };
  }

  function hydrateSnapshot(compact) {
    if (!compact || typeof compact !== 'object' || !Array.isArray(compact.layers)) {
      return deepClone(compact);
    }
    const layers = compact.layers.map((layer) => {
      if (!layer || typeof layer !== 'object' || !layer.__geojsonBlobId) {
        return deepClone(layer);
      }
      const { __geojsonBlobId: blobId, ...rest } = layer;
      const raw = blobStore.get(blobId);
      return {
        ...deepClone(rest),
        geojson: raw ? JSON.parse(raw) : null,
      };
    });
    return {
      ...deepClone(compact),
      layers,
    };
  }

  function gcBlobs() {
    const referenced = new Set();
    entries.forEach((entry) => {
      entry.blobIds.forEach((id) => referenced.add(id));
    });
    for (const id of blobStore.keys()) {
      if (!referenced.has(id)) {
        blobStore.delete(id);
      }
    }
  }

  function getTotalBytes() {
    let total = 0;
    for (const serializedBlob of blobStore.values()) {
      total += serializedBlob.length;
    }
    entries.forEach((entry) => {
      total += entry.serialized.length;
    });
    return total;
  }

  function enforceBounds() {
    while (entries.length > maxEntries) {
      entries.shift();
    }
    gcBlobs();
    while (entries.length > 1 && getTotalBytes() > maxBytes) {
      entries.shift();
      gcBlobs();
    }
    index = entries.length - 1;
  }

  function push(snapshot, label = '') {
    if (snapshot === undefined || snapshot === null) return false;
    const { compact, blobIds } = compactSnapshot(snapshot);
    const serialized = JSON.stringify(compact);

    if (index >= 0 && entries[index]?.serialized === serialized) {
      gcBlobs();
      return false;
    }

    if (index < entries.length - 1) {
      entries = entries.slice(0, index + 1);
    }

    entries.push({
      compact,
      serialized,
      blobIds,
      label: typeof label === 'string' ? label : '',
    });

    enforceBounds();
    return true;
  }

  function canUndo() {
    return index > 0;
  }

  function canRedo() {
    return index >= 0 && index < entries.length - 1;
  }

  function undo() {
    if (!canUndo()) return null;
    index -= 1;
    return hydrateSnapshot(entries[index].compact);
  }

  function redo() {
    if (!canRedo()) return null;
    index += 1;
    return hydrateSnapshot(entries[index].compact);
  }

  function getStatus() {
    return {
      canUndo: canUndo(),
      canRedo: canRedo(),
      size: entries.length,
      index,
      blobCount: blobStore.size,
      totalBytes: getTotalBytes(),
      maxBytes,
      undoLabel: canUndo() ? entries[index].label : '',
      redoLabel: canRedo() ? entries[index + 1].label : '',
    };
  }

  function clear(initialSnapshot = null) {
    entries = [];
    blobStore.clear();
    index = -1;
    if (initialSnapshot !== null && initialSnapshot !== undefined) {
      push(initialSnapshot, 'Initial');
    }
  }

  if (options.initialSnapshot !== undefined && options.initialSnapshot !== null) {
    push(options.initialSnapshot, 'Initial');
  }

  return {
    push,
    canUndo,
    canRedo,
    undo,
    redo,
    getStatus,
    clear,
  };
}

function isEditableEventTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tagName = String(target.tagName || '').toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) return true;
  if (typeof target.closest === 'function') {
    if (target.closest('dialog[open], .modal.show')) return true;
  }
  return false;
}

function shouldHandleUndoRedoShortcut(event) {
  if (!event || event.altKey) return null;
  if (!(event.metaKey || event.ctrlKey)) return null;
  if (isEditableEventTarget(event.target)) return null;

  const key = String(event.key || '').toLowerCase();
  if (key === 'z' && !event.shiftKey) return 'undo';
  if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) return 'redo';
  return null;
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  createHistoryStack,
  isEditableEventTarget,
  shouldHandleUndoRedoShortcut,
};
