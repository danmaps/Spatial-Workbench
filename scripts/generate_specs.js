// Generate tool specs with minimal mocks to avoid browser-only side effects.
// Usage:
//   node scripts/generate_specs.js           -> writes js/tools/specs.json
//   node scripts/generate_specs.js --check   -> exits nonzero if drift

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'js', 'tools', 'specs.json');

const TOOL_NAMES = [
  'AddDataTool',
  'BufferTool',
  'ExportTool',
  'GenerateAIFeatures',
  'GroupTool',
  'RandomPointsTool',
];

function ensureMock(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { exports: exportsObj };
}

function bootstrapMocks() {
  // Avoid loading real app.js (creates Leaflet map)
  ensureMock(path.join(ROOT, 'js', 'app.js'), {
    map: {},
    drawnItems: {},
    tocLayers: [],
  });

  // Leaflet/Turf are global in the browser. Provide tiny stubs.
  global.L = global.L || {};
  global.turf = global.turf || {};

  // Minimal DOM for any constructor that might touch it (none should).
  global.document = global.document || {
    getElementById: () => null,
    createElement: () => ({})
  };
}

function loadSpecs() {
  bootstrapMocks();
  const specs = [];

  for (const name of TOOL_NAMES) {
    const ToolClass = require(path.join(ROOT, 'js', 'tools', name))[name];
    const tool = new ToolClass();
    if (typeof tool.getSpec !== 'function') {
      throw new Error(`Tool ${name} is missing getSpec()`);
    }
    specs.push(tool.getSpec());
  }

  return specs;
}

function main() {
  const check = process.argv.includes('--check');
  const specs = loadSpecs();

  if (check) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error('specs.json is missing. Run: npm run spec:update');
      process.exit(1);
    }
    const current = fs.readFileSync(OUT_PATH, 'utf-8');
    const next = JSON.stringify(specs, null, 2) + '\n';
    if (current !== next) {
      console.error('specs.json is out of date. Run: npm run spec:update');
      process.exit(1);
    }
    console.log('specs.json is up to date.');
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(specs, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${OUT_PATH}`);
}

main();
