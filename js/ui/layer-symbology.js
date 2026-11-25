// Declarative layer styling. This module has no Leaflet or application state.
const PALETTES = Object.freeze({
  default: Object.freeze(['#38bdf8', '#f59e0b', '#ec4899', '#34d399', '#a78bfa', '#fb7185', '#facc15', '#2dd4bf', '#60a5fa', '#fb923c']),
  vivid: Object.freeze(['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf']),
});
const RAMPS = Object.freeze({
  blue: Object.freeze(['#eff6ff', '#93c5fd', '#1d4ed8']),
  viridis: Object.freeze(['#440154', '#31688e', '#35b779', '#fde725']),
});
const FALLBACK_COLOR = '#94a3b8';
const DEFAULTS = Object.freeze({
  version: 'swb.style.v1', mode: 'single', field: '', palette: 'default', ramp: 'blue',
  fallbackColor: FALLBACK_COLOR,
  paint: Object.freeze({ fillColor: '#3388ff', color: '#3388ff', fillOpacity: 0.5, opacity: 1, weight: 3, radius: 7 }),
});

function validateSymbology(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Symbology must be an object');
  const allowed = [...Object.keys(DEFAULTS), 'color', 'opacity'];
  if (Object.keys(spec).some((key) => !allowed.includes(key))) throw new TypeError('Unknown symbology property');
  if (spec.paint !== undefined && (!spec.paint || typeof spec.paint !== 'object' || Array.isArray(spec.paint))) throw new TypeError('Paint must be an object');
  if (Object.keys(spec.paint || {}).some((key) => !Object.hasOwn(DEFAULTS.paint, key))) throw new TypeError('Unknown paint property');
  const paint = {
    ...DEFAULTS.paint,
    ...(spec.color !== undefined ? { color: spec.color, fillColor: spec.color } : {}),
    ...(spec.opacity !== undefined ? { opacity: spec.opacity, fillOpacity: spec.opacity } : {}),
    ...spec.paint,
  };
  const result = {
    version: Object.hasOwn(spec, 'version') ? spec.version : DEFAULTS.version,
    mode: Object.hasOwn(spec, 'mode') ? spec.mode : DEFAULTS.mode,
    field: Object.hasOwn(spec, 'field') ? spec.field : DEFAULTS.field,
    palette: Object.hasOwn(spec, 'palette') ? spec.palette : DEFAULTS.palette,
    ramp: Object.hasOwn(spec, 'ramp') ? spec.ramp : DEFAULTS.ramp,
    fallbackColor: Object.hasOwn(spec, 'fallbackColor') ? spec.fallbackColor : DEFAULTS.fallbackColor,
    paint,
  };
  if (result.version !== DEFAULTS.version) throw new TypeError('Invalid symbology version');
  if (!['single', 'categorical', 'graduated'].includes(result.mode)) throw new TypeError('Invalid symbology mode');
  for (const color of [result.fallbackColor, paint.color, paint.fillColor]) {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError('Color must be a six-digit hex color');
  }
  if (typeof result.field !== 'string' || (result.mode !== 'single' && !result.field.trim())) throw new TypeError('A field is required');
  if (!Object.hasOwn(PALETTES, result.palette)) throw new TypeError('Invalid palette');
  if (!Object.hasOwn(RAMPS, result.ramp)) throw new TypeError('Invalid ramp');
  for (const value of [paint.opacity, paint.fillOpacity]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('Opacity must be between 0 and 1');
  }
  for (const [key, max] of [['weight', 20], ['radius', 100]]) {
    if (typeof paint[key] !== 'number' || !Number.isFinite(paint[key]) || paint[key] < 0 || paint[key] > max) throw new TypeError(`Invalid ${key}`);
  }
  return result;
}

function featuresOf(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'Feature') return [geojson];
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    return geojson.features.flatMap(featuresOf);
  }
  return [];
}

function categoryKey(value) {
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${value}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  return null;
}

function getSymbologyDomain(geojson, inputSpec) {
  if (!inputSpec) return { fallbackUsed: false };
  const spec = validateSymbology(inputSpec);
  if (spec.mode === 'single') return { fallbackUsed: false };
  const values = featuresOf(geojson).map((feature) => feature.properties?.[spec.field]);
  if (spec.mode === 'categorical') {
    const categories = new Map();
    let fallbackUsed = false;
    values.forEach((value) => {
      const key = categoryKey(value);
      if (key === null) fallbackUsed = true;
      else if (!categories.has(key)) categories.set(key, value);
    });
    const palette = PALETTES[spec.palette];
    return {
      categories: Array.from(categories.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([, value], index) => ({ value, label: value === '' ? '(empty string)' : String(value), color: palette[index % palette.length] })),
      fallbackUsed,
    };
  }
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  const extent = numbers.reduce((range, value) => ({
    min: Math.min(range.min, value), max: Math.max(range.max, value),
  }), { min: Infinity, max: -Infinity });
  return {
    min: numbers.length ? extent.min : null,
    max: numbers.length ? extent.max : null,
    fallbackUsed: numbers.length !== values.length,
  };
}

function rampColor(colors, fraction) {
  const position = Math.max(0, Math.min(1, fraction)) * (colors.length - 1);
  const left = Math.floor(position);
  const right = Math.min(left + 1, colors.length - 1);
  const mix = position - left;
  const channels = [1, 3, 5].map((offset) => {
    const a = parseInt(colors[left].slice(offset, offset + 2), 16);
    const b = parseInt(colors[right].slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * mix).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function createSymbologyResolver(inputSpec, domain) {
  const spec = validateSymbology(inputSpec);
  const categories = new Map((domain?.categories || []).map(({ value, color }) => [categoryKey(value), color]));
  return (feature) => {
    let color = spec.paint.fillColor;
    if (spec.mode === 'categorical') {
      const key = categoryKey(feature?.properties?.[spec.field]);
      color = key === null ? spec.fallbackColor : (categories.get(key) || spec.fallbackColor);
    } else if (spec.mode === 'graduated') {
      const value = feature?.properties?.[spec.field];
      color = typeof value === 'number' && Number.isFinite(value) && Number.isFinite(domain?.min) && Number.isFinite(domain?.max)
        ? rampColor(RAMPS[spec.ramp], domain.max === domain.min ? 0.5 : (value - domain.min) / (domain.max - domain.min))
        : spec.fallbackColor;
    }
    return { ...spec.paint, color: spec.mode === 'single' ? spec.paint.color : color, fillColor: color };
  };
}

function resolveSymbology(feature, inputSpec, domain) {
  return createSymbologyResolver(inputSpec, domain)(feature);
}

module.exports = { PALETTES, RAMPS, FALLBACK_COLOR, DEFAULTS, validateSymbology, getSymbologyDomain, resolveSymbology, createSymbologyResolver, rampColor };
