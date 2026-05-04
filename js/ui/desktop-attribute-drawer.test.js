const {
  setDesktopAttributeDrawerOpen,
  initializeDesktopAttributeDrawer,
} = require('./desktop-attribute-drawer');

describe('desktop attribute drawer', () => {
  test('setDesktopAttributeDrawerOpen keeps class and aria state in sync', () => {
    document.body.innerHTML = `
      <section id="drawer" class="desktop-attribute-drawer is-open"></section>
      <button id="toggle" aria-expanded="true"></button>
    `;

    const drawer = document.getElementById('drawer');
    const toggle = document.getElementById('toggle');

    setDesktopAttributeDrawerOpen(drawer, toggle, false);
    expect(drawer.classList.contains('is-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    setDesktopAttributeDrawerOpen(drawer, toggle, true);
    expect(drawer.classList.contains('is-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('initializeDesktopAttributeDrawer starts collapsed by default and toggles open', () => {
    jest.useFakeTimers();

    document.body.innerHTML = `
      <section id="drawer" class="desktop-attribute-drawer is-open"></section>
      <button id="toggle" aria-expanded="true"></button>
    `;

    const drawer = document.getElementById('drawer');
    const toggle = document.getElementById('toggle');
    const map = { invalidateSize: jest.fn() };

    const controller = initializeDesktopAttributeDrawer(drawer, toggle, map);

    expect(controller.isOpen()).toBe(false);
    expect(drawer.classList.contains('is-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(controller.isOpen()).toBe(true);
    expect(drawer.classList.contains('is-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    jest.runAllTimers();
    expect(map.invalidateSize).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
