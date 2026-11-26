const {
  DEFAULTS, PALETTES, RAMPS, validateSymbology, getSymbologyDomain, resolveSymbology, rampColor,
} = require('./layer-symbology');

const feature = (value) => ({ type: 'Feature', properties: { value }, geometry: { type: 'Point', coordinates: [0, 0] } });
const collection = (values) => ({ type: 'FeatureCollection', features: values.map(feature) });

test('normalizes and validates a complete v1 style without discarding paint', () => {
  const spec = validateSymbology({
    version: 'swb.style.v1', mode: 'single', fallbackColor: '#123456',
    paint: { color: '#112233', fillColor: '#aabbcc', fillOpacity: 0.3, opacity: 0.7, weight: 5, radius: 11 },
  });
  expect(resolveSymbology(feature(1), spec)).toEqual(spec.paint);
  expect(spec.fallbackColor).toBe('#123456');
  expect(DEFAULTS.version).toBe('swb.style.v1');
  for (const invalid of [
    { version: null }, { mode: 'categorical' }, { paint: { radius: -1 } },
    { paint: { fillOpacity: 2 } }, { fallbackColor: 'red' }, { palette: 'unknown' },
    { paint: { color: '"><script>' } }, { unexpected: 1 },
  ]) expect(() => validateSymbology(invalid)).toThrow(TypeError);
});

test('categorical domains distinguish types and resolve missing values to the requested fallback', () => {
  const spec = { mode: 'categorical', field: 'value', fallbackColor: '#123456' };
  const domain = getSymbologyDomain(collection(['1', 1, 'z', null, false, {}, '']), spec);
  expect(domain.categories.map(({ value }) => value)).toEqual([false, 1, '', '1', 'z']);
  expect(domain.categories.find(({ value }) => value === '').label).toBe('(empty string)');
  expect(domain.categories[0].color).toBe(PALETTES.default[0]);
  expect(domain.fallbackUsed).toBe(true);
  expect(resolveSymbology(feature(null), spec, domain).fillColor).toBe('#123456');
  expect(resolveSymbology(feature(1), spec, domain).fillColor).not.toBe(resolveSymbology(feature('1'), spec, domain).fillColor);
  expect(getSymbologyDomain(collection(['z', false, 1, '1', '']), spec).categories).toEqual(domain.categories);
});

test('graduated domains use finite numbers only and handle constant and empty ranges', () => {
  const spec = { mode: 'graduated', field: 'value', ramp: 'blue' };
  const domain = getSymbologyDomain(collection([-2, 4, '3', null]), spec);
  expect(domain).toEqual({ min: -2, max: 4, fallbackUsed: true });
  expect(resolveSymbology(feature(-2), spec, domain).color).toBe(RAMPS.blue[0]);
  expect(resolveSymbology(feature(4), spec, domain).color).toBe(RAMPS.blue[RAMPS.blue.length - 1]);
  expect(resolveSymbology(feature(1), spec, domain).color).toBe(rampColor(RAMPS.blue, 0.5));
  expect(resolveSymbology(feature('3'), spec, domain).color).toBe('#94a3b8');
  const zero = getSymbologyDomain(collection([0, 10]), spec);
  expect(resolveSymbology(feature(0), spec, zero).color).toBe(RAMPS.blue[0]);
  const constant = getSymbologyDomain(collection([2]), spec);
  expect(resolveSymbology(feature(2), spec, constant).color).toBe(rampColor(RAMPS.blue, 0.5));
  expect(getSymbologyDomain(collection([null]), spec)).toEqual({ min: null, max: null, fallbackUsed: true });
  expect(getSymbologyDomain(collection(Array(150000).fill(1)), spec).max).toBe(1);
});

test('supports dark-basemap amber-rose and cyan-blue graduated ramps (#172)', () => {
  expect(RAMPS['amber-rose']).toHaveLength(4);
  expect(RAMPS['cyan-blue']).toHaveLength(4);
  const amberSpec = validateSymbology({ mode: 'graduated', field: 'value', ramp: 'amber-rose' });
  const cyanSpec = validateSymbology({ mode: 'graduated', field: 'value', ramp: 'cyan-blue' });
  expect(resolveSymbology(feature(0), amberSpec, { min: 0, max: 10 }).fillColor).toBe(RAMPS['amber-rose'][0]);
  expect(resolveSymbology(feature(10), cyanSpec, { min: 0, max: 10 }).fillColor).toBe(RAMPS['cyan-blue'][3]);
});
