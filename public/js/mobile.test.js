describe('mobile tab behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div class="mobile-bar">
        <button class="mobile-tab" data-view="map">Map</button>
        <button class="mobile-tab" data-view="tools">Tools</button>
        <button class="mobile-tab" data-view="data">Data</button>
      </div>
      <div id="toolSelection"></div>
      <section id="attributePanel"></section>
    `;

    document.getElementById('toolSelection').scrollIntoView = jest.fn();
    document.getElementById('attributePanel').scrollIntoView = jest.fn();
  });

  const loadMobileScript = () => {
    require('./mobile');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  };

  test('defaults to map view on load', () => {
    loadMobileScript();

    expect(document.body.dataset.view).toBe('map');
    expect(document.querySelector('.mobile-tab[data-view="map"]').classList.contains('active')).toBe(true);
  });

  test('switches to tools view and scrolls tool content into view', () => {
    loadMobileScript();

    document.querySelector('.mobile-tab[data-view="tools"]').click();

    expect(document.body.dataset.view).toBe('tools');
    expect(document.getElementById('toolSelection').scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(document.getElementById('attributePanel').scrollIntoView).not.toHaveBeenCalled();
  });

  test('switches to data view and scrolls attribute panel into view without touching tools', () => {
    loadMobileScript();

    document.querySelector('.mobile-tab[data-view="data"]').click();

    expect(document.body.dataset.view).toBe('data');
    expect(document.getElementById('attributePanel').scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(document.getElementById('toolSelection').scrollIntoView).not.toHaveBeenCalled();
  });
});
