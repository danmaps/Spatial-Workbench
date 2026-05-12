const MAP_INTERACTION_MODES = Object.freeze({
  SELECT: 'select',
  INSPECT: 'inspect',
});

function normalizeMapInteractionMode(mode) {
  return mode === MAP_INTERACTION_MODES.INSPECT
    ? MAP_INTERACTION_MODES.INSPECT
    : MAP_INTERACTION_MODES.SELECT;
}

function shouldOpenPopupForMapInteractionMode(mode) {
  return normalizeMapInteractionMode(mode) === MAP_INTERACTION_MODES.INSPECT;
}

module.exports = {
  MAP_INTERACTION_MODES,
  normalizeMapInteractionMode,
  shouldOpenPopupForMapInteractionMode,
};
