// Run against the actual origin and each replica after restart. TLS verification
// remains enabled. Old deployments without runtime metadata fail this check.
const { assertNodeRuntime } = require('./check-node-runtime');

async function main() {
  assertNodeRuntime();
  const base = process.argv[2];
  if (!base) throw new Error('Usage: node scripts/verify-deployed-runtime.js <base-url>');
  const response = await fetch(new URL('/api/state', base), {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const state = await response.json();
  if (!state.ok || !state.runtime?.node) throw new Error('Serving process did not report a Node runtime');
  assertNodeRuntime(state.runtime.node);
  console.log(JSON.stringify({ origin: new URL(base).origin, ...state.runtime }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
