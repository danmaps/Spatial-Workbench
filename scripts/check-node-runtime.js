const REQUIRED_NODE = '>=24.22.1 <25';

function isSupportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === 24 && (minor > 22 || (minor === 22 && patch >= 1));
}

function assertNodeRuntime(version = process.versions.node) {
  if (!isSupportedNode(version)) {
    throw new Error(`Node ${version} is unsupported. Install Node ${REQUIRED_NODE}, then restart the actual service process.`);
  }
}

if (require.main === module) {
  assertNodeRuntime();
  console.log(JSON.stringify({ node: process.versions.node, openssl: process.versions.openssl, required: REQUIRED_NODE }));
}

module.exports = { REQUIRED_NODE, isSupportedNode, assertNodeRuntime };
