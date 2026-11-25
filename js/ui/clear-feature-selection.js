function createClearFeatureSelectionButton(layerId, state, refresh) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-clear-selection';
  button.textContent = 'Clear selection';
  button.setAttribute('aria-label', 'Clear selected features');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    state.clearSelectedFeatureIds(layerId);
    refresh();
  });
  return button;
}

module.exports = { createClearFeatureSelectionButton };
