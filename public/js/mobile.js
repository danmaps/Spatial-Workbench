(function () {
  const tabs = document.querySelectorAll('.mobile-tab');
  if (!tabs.length) return;

  const setActive = (view) => {
    document.body.dataset.view = view;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));

    if (view === 'data') {
      const panel = document.getElementById('attributePanel');
      if (panel) panel.scrollIntoView({ block: 'start' });
    } else if (view === 'tools') {
      const tools = document.getElementById('toolSelection');
      if (tools) tools.scrollIntoView({ block: 'start' });
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActive(tab.dataset.view));
  });

  // Default to map on load for small screens
  setActive('map');
})();
