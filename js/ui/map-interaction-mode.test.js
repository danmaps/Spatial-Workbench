const {
  MAP_INTERACTION_MODES,
  normalizeMapInteractionMode,
  shouldOpenPopupForMapInteractionMode,
} = require('./map-interaction-mode');

describe('map interaction mode helpers', () => {
  test('defaults unknown modes to select', () => {
    expect(normalizeMapInteractionMode()).toBe(MAP_INTERACTION_MODES.SELECT);
    expect(normalizeMapInteractionMode('weird')).toBe(MAP_INTERACTION_MODES.SELECT);
  });

  test('preserves inspect mode explicitly', () => {
    expect(normalizeMapInteractionMode(MAP_INTERACTION_MODES.INSPECT)).toBe(MAP_INTERACTION_MODES.INSPECT);
    expect(shouldOpenPopupForMapInteractionMode(MAP_INTERACTION_MODES.INSPECT)).toBe(true);
  });

  test('select mode does not open popups', () => {
    expect(shouldOpenPopupForMapInteractionMode(MAP_INTERACTION_MODES.SELECT)).toBe(false);
  });
});
