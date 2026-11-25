const { getSymbologyDomain } = require('./layer-symbology');

function createDrawStyleGuard({ map, state, getLayers, closeEditor, refresh }) {
  let editing = false;
  map.on('draw:editstart', () => {
    editing = true;
    closeEditor();
    refresh();
  });
  map.on('draw:editstop', () => {
    editing = false;
    getLayers().forEach((layer) => {
      const spec = state.getLayerSymbology(layer);
      if (spec) state.setLayerSymbology(layer, spec);
    });
    refresh();
  });
  return {
    isEditing: () => editing,
    getDomain(layer, spec, geojson) {
      return editing ? getSymbologyDomain(geojson, spec) : state.getLayerSymbologyDomain(layer);
    },
  };
}

module.exports = { createDrawStyleGuard };
