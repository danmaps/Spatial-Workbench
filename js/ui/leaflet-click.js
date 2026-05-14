function stopLeafletClickPropagation(event) {
  if (!event) return;

  if (typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }

  const originalEvent = event.originalEvent;
  if (originalEvent && typeof originalEvent.stopPropagation === 'function') {
    originalEvent.stopPropagation();
  }
}

module.exports = {
  stopLeafletClickPropagation,
};
