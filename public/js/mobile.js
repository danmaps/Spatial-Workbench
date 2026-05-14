(function () {
  const tabs = document.querySelectorAll('.mobile-tab');
  const mobileBar = document.querySelector('.mobile-bar');
  if (!tabs.length || !mobileBar) return;

  const updateMobileOffset = () => {
    const height = Math.ceil(mobileBar.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--mobile-bar-offset', `${height}px`);
    return height;
  };

  const scrollPanelIntoView = (element) => {
    if (!element) return;
    updateMobileOffset();
    element.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  const focusMap = () => {
    const mapPane = document.getElementById('mapPane') || document.getElementById('map');
    if (!mapPane) return;
    if (!mapPane.hasAttribute('tabindex')) mapPane.setAttribute('tabindex', '-1');
    if (typeof mapPane.focus === 'function') {
      mapPane.focus({ preventScroll: true });
    }
  };

  const setActive = (view) => {
    document.body.dataset.view = view;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));

    if (view === 'map') {
      focusMap();
      return;
    }

    if (view === 'data') {
      scrollPanelIntoView(document.getElementById('attributePanel'));
    } else if (view === 'tools') {
      scrollPanelIntoView(document.getElementById('toolSelection'));
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActive(tab.dataset.view));
  });

  document.querySelectorAll('[data-mobile-close-map]').forEach((button) => {
    button.addEventListener('click', () => setActive('map'));
  });

  window.addEventListener('resize', updateMobileOffset);
  window.addEventListener('orientationchange', updateMobileOffset);

  updateMobileOffset();
  // Default to map on load for small screens
  setActive('map');
})();
