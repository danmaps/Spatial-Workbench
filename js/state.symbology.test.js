const L = require('leaflet');
const { getFeatureSymbologyStyle } = require('./ui/selection-style');
const mockMap = { on: jest.fn(), hasLayer: jest.fn(() => false) };
jest.mock('./app', () => ({ map: mockMap, drawnItems: { hasLayer: () => false }, tocLayers: [] }));

const feature = (id, value) => ({
  type: 'Feature', id, properties: { __id: id, value },
  geometry: { type: 'Point', coordinates: [0, 0] },
});

describe('layer symbology rendering', () => {
  let state;
  beforeEach(() => {
    jest.resetModules();
    global.L = L;
    state = require('./state');
  });

  test('styles an ordinary marker without replacing it or losing selection, listeners, or editability', () => {
    const marker = L.marker([1, 2], { draggable: true, opacity: 0.8 });
    marker.feature = feature('point', 1);
    const originalIcon = marker.options.icon;
    const click = jest.fn();
    marker.on('click', click);
    state.registerLayer(marker, 'point');
    state.selectLayer('point', { makeActive: true });
    state.setSelectedFeatureIds('point', ['point']);
    const spec = state.setLayerSymbology('point', {
      mode: 'single', paint: { fillColor: '#ff0000', color: '#0000ff', fillOpacity: 0.2, opacity: 0.6, radius: 12, weight: 4 },
    });
    expect(marker.options.icon.options.html).toContain('r="12"');
    expect(marker.options.icon.options.html).toContain('fill-opacity="0.2"');
    expect(marker.options.icon.options.html).toContain('stroke-opacity="0.6"');
    expect(marker.options.icon.options.html).toContain('stroke-width="4"');
    expect(marker.options.draggable).toBe(true);
    marker.fire('click');
    expect(click).toHaveBeenCalledTimes(1);
    expect(state.getLayer('point')).toBe(marker);
    expect(state.getSelectedFeatureIds('point')).toEqual(['point']);
    expect(state.getActiveLayerId()).toBe('point');
    spec.paint.radius = 99;
    expect(state.getLayerSymbology(marker).paint.radius).toBe(12);
    expect(() => state.setLayerSymbology(marker, { paint: { radius: -1 } })).toThrow();
    expect(state.getLayerSymbology(marker).paint.radius).toBe(12);
    state.resetLayerSymbology(marker);
    expect(marker.options.icon).toBe(originalIcon);
    expect(marker.options.opacity).toBe(0.8);
    expect(state.getLayerSymbology(marker)).toBeNull();
  });

  test('recursively styles nested collections, restores automatic visuals and refreshes after edits', () => {
    const a = L.circleMarker([0, 0], { color: '#abcdef', fillColor: '#fedcba', radius: 4, dashArray: '4 4' });
    a.feature = feature('a', 1);
    a.__symbologyStyle = { color: '#abcdef' };
    const b = L.marker([1, 1]);
    b.feature = feature('b', 2);
    const icon = b.options.icon;
    const nested = L.featureGroup([a, b]);
    const group = L.featureGroup([nested]);
    state.registerLayer(group, 'collection');
    state.setLayerSymbology(group, { mode: 'graduated', field: 'value', paint: { radius: 10 } });
    expect(state.getLayerSymbologyDomain(group)).toEqual({ min: 1, max: 2, fallbackUsed: false });
    expect(a.getRadius()).toBe(10);
    expect(a.options.color).toBe('#eff6ff');
    const setStyle = jest.spyOn(a, 'setStyle');
    state.getLayerSymbologyDomain(group);
    expect(setStyle).not.toHaveBeenCalled();
    b.feature.properties.value = -1;
    expect(state.getLayerSymbologyDomain(group)).toEqual({ min: -1, max: 1, fallbackUsed: false });
    expect(a.options.color).toBe('#1d4ed8');
    expect(setStyle).toHaveBeenCalledTimes(1);
    state.resetLayerSymbology(group);
    expect(a.options.color).toBe('#abcdef');
    expect(a.options.fillColor).toBe('#fedcba');
    expect(a.options.dashArray).toBe('4 4');
    expect(a.getRadius()).toBe(4);
    expect(a.__symbologyStyle).toEqual({ color: '#abcdef' });
    expect(b.options.icon).toBe(icon);
  });

  test('does not alter geographic radius of a drawn circle', () => {
    const circle = L.circle([1, 1], { radius: 500 });
    state.registerLayer(circle, 'circle');
    state.setLayerSymbology(circle, { mode: 'single', paint: { radius: 8, color: '#123456' } });
    expect(circle.getRadius()).toBe(500);
    expect(circle.options.color).toBe('#123456');
    state.resetLayerSymbology(circle);
    expect(circle.getRadius()).toBe(500);
  });

  test('styles multipart imported children and restores group and comparison automatic styles', () => {
    const data = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { __id: 'multi', value: 'A' }, geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] } },
        { type: 'Feature', properties: { __id: 'ungrouped', groupId: null, value: 'A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: 'Feature', properties: { __id: 'comparison', comparisonRole: 'only-in-a', value: 'B' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    };
    const group = L.geoJSON(data, {
      style: (item) => getFeatureSymbologyStyle(item),
      pointToLayer: (item, latlng) => L.circleMarker(latlng, getFeatureSymbologyStyle(item)),
    });
    const [multipart, ungrouped, comparison] = group.getLayers();
    const points = multipart.getLayers();
    const groupStyle = getFeatureSymbologyStyle(data.features[1]);
    const compareStyle = getFeatureSymbologyStyle(data.features[2]);
    expect(ungrouped.options.dashArray).toBe(groupStyle.dashArray);
    expect(comparison.options.dashArray).toBe(compareStyle.dashArray);
    state.registerLayer(group, 'imported');
    state.setSelectedFeatureIds('imported', ['multi', 'comparison']);
    state.setLayerSymbology('imported', { mode: 'categorical', field: 'value' });
    expect(points[0].options.color).toBe(points[1].options.color);
    expect(points[0].options.dashArray).toBeNull();
    expect(comparison.options.dashArray).toBeNull();
    expect(state.getSelectedFeatureIds('imported')).toEqual(['multi', 'comparison']);
    state.resetLayerSymbology('imported');
    expect(ungrouped.options.dashArray).toBe(groupStyle.dashArray);
    expect(comparison.options.dashArray).toBe(compareStyle.dashArray);
    expect(comparison.options.color).toBe(compareStyle.color);
    expect(state.getSelectedFeatureIds('imported')).toEqual(['multi', 'comparison']);
  });

  test('applyResult restores valid symbology on GeoJSON import and safely ignores invalid specs', () => {
    const validGeojson = {
      type: 'FeatureCollection',
      symbology: {
        version: 'swb.style.v1',
        mode: 'categorical',
        field: 'zone',
        palette: 'default',
      },
      features: [
        { type: 'Feature', properties: { __id: 'z-1', zone: 'north' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: 'Feature', properties: { __id: 'z-2', zone: 'south' }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] } },
      ],
    };

    const resValid = state.applyResult({ addGeojson: validGeojson });
    expect(resValid.ok).toBe(true);
    const addedId = resValid.added[0];
    expect(state.getLayerSymbology(addedId)).toEqual(
      expect.objectContaining({ mode: 'categorical', field: 'zone', palette: 'default' })
    );

    const invalidGeojson = {
      type: 'FeatureCollection',
      symbology: { version: 'bad.v99', mode: 'unknown' },
      features: [
        { type: 'Feature', properties: { __id: 'x-1', zone: 'west' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ],
    };
    const resInvalid = state.applyResult({ addGeojson: invalidGeojson });
    expect(resInvalid.ok).toBe(true);
    expect(state.getLayerSymbology(resInvalid.added[0])).toBeNull();
  });

  test('captureWorkspaceSnapshot and restoreWorkspaceSnapshot preserve layers, names, and symbology for undo/redo (#180)', () => {
    const initialSnap = state.captureWorkspaceSnapshot();
    expect(initialSnap.layers).toEqual([]);

    const res = state.applyResult({
      addGeojson: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { __id: 'pt-1', zone: 'alpha' }, geometry: { type: 'Point', coordinates: [-118, 34] } },
          { type: 'Feature', properties: { __id: 'pt-2', zone: 'beta' }, geometry: { type: 'Point', coordinates: [-117, 33] } },
        ],
      },
    });
    const layerId = res.added[0];
    state.setLayerName(layerId, 'Study Sites');
    state.setLayerSymbology(layerId, { mode: 'categorical', field: 'zone', palette: 'default' });

    const styledSnap = state.captureWorkspaceSnapshot();
    expect(styledSnap.layers).toHaveLength(1);
    expect(styledSnap.layers[0]).toEqual(
      expect.objectContaining({
        id: layerId,
        name: 'Study Sites',
        symbology: expect.objectContaining({ mode: 'categorical', field: 'zone' }),
      })
    );

    // Undo back to empty
    state.restoreWorkspaceSnapshot(initialSnap);
    expect(state.listLayers()).toHaveLength(0);

    // Redo back to styled layer
    state.restoreWorkspaceSnapshot(styledSnap);
    expect(state.listLayers()).toHaveLength(1);
    expect(state.getLayerName(layerId)).toBe('Study Sites');
    expect(state.getLayerSymbology(layerId)).toEqual(
      expect.objectContaining({ mode: 'categorical', field: 'zone', palette: 'default' })
    );
  });
});
