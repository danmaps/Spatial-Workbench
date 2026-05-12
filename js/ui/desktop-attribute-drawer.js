function setDesktopAttributeDrawerOpen(drawer, toggle, isOpen) {
  if (!drawer || !toggle) return isOpen;

  drawer.classList.toggle('is-open', Boolean(isOpen));
  toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  return Boolean(isOpen);
}

function initializeDesktopAttributeDrawer(drawer, toggle, map, options = {}) {
  if (!drawer || !toggle) return null;

  const defaultOpen = options.defaultOpen === true;
  let isOpen = setDesktopAttributeDrawerOpen(drawer, toggle, defaultOpen);

  toggle.addEventListener('click', () => {
    isOpen = setDesktopAttributeDrawerOpen(drawer, toggle, !isOpen);
    if (map && typeof map.invalidateSize === 'function') {
      window.setTimeout(() => map.invalidateSize(), 180);
    }
  });

  return {
    isOpen: () => isOpen,
    setOpen(nextOpen) {
      isOpen = setDesktopAttributeDrawerOpen(drawer, toggle, nextOpen);
      return isOpen;
    },
  };
}

module.exports = {
  setDesktopAttributeDrawerOpen,
  initializeDesktopAttributeDrawer,
};
