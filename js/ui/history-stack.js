function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHistoryStack(options = {}) {
  const maxEntries = Math.max(2, Number(options.maxEntries) || 25);
  let entries = [];
  let index = -1;

  function push(snapshot, label = '') {
    if (snapshot === undefined || snapshot === null) return false;
    const serialized = JSON.stringify(snapshot);
    if (index >= 0 && entries[index]?.serialized === serialized) {
      return false;
    }

    if (index < entries.length - 1) {
      entries = entries.slice(0, index + 1);
    }

    entries.push({
      snapshot: JSON.parse(serialized),
      serialized,
      label: typeof label === 'string' ? label : '',
    });

    if (entries.length > maxEntries) {
      const overflow = entries.length - maxEntries;
      entries = entries.slice(overflow);
    }

    index = entries.length - 1;
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
    return deepClone(entries[index].snapshot);
  }

  function redo() {
    if (!canRedo()) return null;
    index += 1;
    return deepClone(entries[index].snapshot);
  }

  function getStatus() {
    return {
      canUndo: canUndo(),
      canRedo: canRedo(),
      size: entries.length,
      index,
      undoLabel: canUndo() ? entries[index].label : '',
      redoLabel: canRedo() ? entries[index + 1].label : '',
    };
  }

  function clear(initialSnapshot = null) {
    entries = [];
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
  createHistoryStack,
  isEditableEventTarget,
  shouldHandleUndoRedoShortcut,
};
