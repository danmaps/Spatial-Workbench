const fs = require('fs');
const path = require('path');

describe('desktop layout shell', () => {
  test('keeps the desktop attribute drawer inside the map pane and the right sidebar separate', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    document.documentElement.innerHTML = html;

    const layout = document.querySelector('.app-layout');
    const mapPane = document.getElementById('mapPane');
    const map = document.getElementById('map');
    const drawer = document.getElementById('desktopAttributeDrawer');
    const sidebar = document.getElementById('sidebar');
    const toc = document.getElementById('toc');

    expect(layout).not.toBeNull();
    expect(toc?.parentElement).toBe(layout);
    expect(mapPane?.parentElement).toBe(layout);
    expect(sidebar?.parentElement).toBe(layout);
    expect(mapPane?.contains(map)).toBe(true);
    expect(mapPane?.contains(drawer)).toBe(true);
    expect(sidebar?.contains(drawer)).toBe(false);
  });
});
