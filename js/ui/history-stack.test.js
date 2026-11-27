const {
  createHistoryStack,
  shouldHandleUndoRedoShortcut,
} = require('./history-stack');

describe('workspace history stack (#180)', () => {
  test('pushes, deduplicates consecutive snapshots, and supports undo/redo with branch truncation', () => {
    const history = createHistoryStack({
      maxEntries: 5,
      initialSnapshot: { layers: [] },
    });

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    // Duplicate snapshot is ignored
    expect(history.push({ layers: [] }, 'No-op')).toBe(false);
    expect(history.getStatus().size).toBe(1);

    expect(history.push({ layers: [{ id: 'a' }] }, 'Add A')).toBe(true);
    expect(history.push({ layers: [{ id: 'a' }, { id: 'b' }] }, 'Add B')).toBe(true);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    const afterUndo1 = history.undo();
    expect(afterUndo1).toEqual({ layers: [{ id: 'a' }] });
    expect(history.canRedo()).toBe(true);

    // Mutating returned snapshot does not corrupt stored history
    afterUndo1.layers.push({ id: 'mutated' });
    expect(history.redo()).toEqual({ layers: [{ id: 'a' }, { id: 'b' }] });

    // Undo and push a new branch truncates redo history
    history.undo();
    expect(history.push({ layers: [{ id: 'a' }, { id: 'c' }] }, 'Add C')).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toEqual({ layers: [{ id: 'a' }] });
    expect(history.redo()).toEqual({ layers: [{ id: 'a' }, { id: 'c' }] });
  });

  test('enforces maxEntries bound by dropping oldest snapshots', () => {
    const history = createHistoryStack({ maxEntries: 3 });
    history.push({ step: 1 });
    history.push({ step: 2 });
    history.push({ step: 3 });
    history.push({ step: 4 });

    expect(history.getStatus().size).toBe(3);
    expect(history.undo()).toEqual({ step: 3 });
    expect(history.undo()).toEqual({ step: 2 });
    expect(history.undo()).toBeNull();
  });

  test('parses Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z / Ctrl+Y shortcuts while ignoring editable targets', () => {
    const body = document.body;
    const input = document.createElement('input');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const dialogBtn = document.createElement('button');
    dialog.appendChild(dialogBtn);
    document.body.append(input, dialog);

    expect(shouldHandleUndoRedoShortcut({ metaKey: true, key: 'z', target: body })).toBe('undo');
    expect(shouldHandleUndoRedoShortcut({ ctrlKey: true, key: 'Z', shiftKey: true, target: body })).toBe('redo');
    expect(shouldHandleUndoRedoShortcut({ ctrlKey: true, key: 'y', target: body })).toBe('redo');
    expect(shouldHandleUndoRedoShortcut({ metaKey: true, key: 'z', target: input })).toBeNull();
    expect(shouldHandleUndoRedoShortcut({ metaKey: true, key: 'z', target: dialogBtn })).toBeNull();
    expect(shouldHandleUndoRedoShortcut({ altKey: true, ctrlKey: true, key: 'z', target: body })).toBeNull();
  });
});
