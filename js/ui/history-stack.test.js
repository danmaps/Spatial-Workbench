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

  test('deduplicates unchanged GeoJSON blobs across metadata/visibility/style edits', () => {
    const bigGeojson = {
      type: 'FeatureCollection',
      features: Array.from({ length: 200 }, (_, i) => ({
        type: 'Feature',
        properties: { id: i, note: 'payload-data-for-dedup-test' },
        geometry: { type: 'Point', coordinates: [-118 + i * 0.001, 34 + i * 0.001] },
      })),
    };
    const history = createHistoryStack({ maxEntries: 10 });
    history.push({ layers: [{ id: 'big', visible: true, name: 'Big', geojson: bigGeojson }] }, 'Import');
    const afterImportBytes = history.getStatus().totalBytes;

    // Toggle visibility, rename, and style 5 times without changing geometry
    history.push({ layers: [{ id: 'big', visible: false, name: 'Big', geojson: bigGeojson }] }, 'Hide');
    history.push({ layers: [{ id: 'big', visible: true, name: 'Big Renamed', geojson: bigGeojson }] }, 'Rename');
    history.push({ layers: [{ id: 'big', visible: true, name: 'Big Renamed', symbology: { mode: 'single' }, geojson: bigGeojson }] }, 'Style');

    const status = history.getStatus();
    expect(status.size).toBe(4);
    expect(status.blobCount).toBe(1);
    // Total memory barely grew beyond the single copy of bigGeojson
    expect(status.totalBytes).toBeLessThan(afterImportBytes + 1500);

    // Hydrates full geojson transparently on undo/redo
    const undone = history.undo();
    expect(undone.layers[0].name).toBe('Big Renamed');
    expect(undone.layers[0].geojson.features).toHaveLength(200);
    expect(undone.layers[0].__geojsonBlobId).toBeUndefined();
  });

  test('evicts oldest snapshots and garbage-collects unreferenced blobs when maxBytes budget is exceeded', () => {
    const makePayload = (tag) => ({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { tag, pad: 'x'.repeat(800) }, geometry: { type: 'Point', coordinates: [0, 0] } }],
    });

    const history = createHistoryStack({ maxEntries: 25, maxBytes: 1600 });
    history.push({ layers: [{ id: 'l1', geojson: makePayload('one') }] }, 'Add 1');
    expect(history.getStatus().blobCount).toBe(1);

    // Deleting l1 and adding a new distinct large payload exceeds 1600 bytes -> evicts l1's snapshot & GCs l1's blob
    history.push({ layers: [{ id: 'l2', geojson: makePayload('two') }] }, 'Replace with 2');

    const status = history.getStatus();
    expect(status.size).toBe(1);
    expect(status.blobCount).toBe(1);
    expect(status.canUndo).toBe(false);
  });
});
