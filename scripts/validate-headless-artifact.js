#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const artifactPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'artifacts', 'headless-demo.geojson');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(artifactPath)) {
  fail(`Headless demo artifact is missing: ${artifactPath}`);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
} catch (error) {
  fail(`Headless demo artifact is not valid JSON: ${error.message}`);
}

if (!parsed || parsed.type !== 'FeatureCollection') {
  fail(`Headless demo artifact must be a GeoJSON FeatureCollection. Received: ${parsed && parsed.type ? parsed.type : 'unknown'}`);
}

if (!Array.isArray(parsed.features)) {
  fail('Headless demo artifact is missing a features array.');
}

if (parsed.features.length < 1) {
  fail('Headless demo artifact must contain at least one feature.');
}

console.log(`Validated headless demo artifact: ${artifactPath} (${parsed.features.length} feature(s))`);
