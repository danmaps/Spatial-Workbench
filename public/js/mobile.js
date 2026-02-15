(function () {
  const tabs = document.querySelectorAll('.mobile-tab');
  if (!tabs.length) return;

  const setActive = (view) => {
    document.body.dataset.view = view;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActive(tab.dataset.view));
  });

  // Default to map on load for small screens
  setActive('map');
})();
