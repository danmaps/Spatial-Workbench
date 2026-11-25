const { createClearFeatureSelectionButton } = require('./clear-feature-selection');

test('clear selection stops row activation and does not change the layer style', () => {
  const state = { clearSelectedFeatureIds: jest.fn(), setLayerSymbology: jest.fn(), resetLayerSymbology: jest.fn() };
  const refresh = jest.fn();
  const row = document.createElement('div');
  const activate = jest.fn();
  row.addEventListener('click', activate);
  const button = createClearFeatureSelectionButton('layer-1', state, refresh);
  row.appendChild(button);
  expect(button.getAttribute('aria-label')).toBe('Clear selected features');
  button.click();
  expect(state.clearSelectedFeatureIds).toHaveBeenCalledWith('layer-1');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(activate).not.toHaveBeenCalled();
  expect(state.setLayerSymbology).not.toHaveBeenCalled();
  expect(state.resetLayerSymbology).not.toHaveBeenCalled();
});
