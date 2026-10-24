const { isSupportedNode, assertNodeRuntime } = require('./scripts/check-node-runtime');

test.each(['20.20.0', '22.23.4', '24.22.0', '24.21.9', '25.0.0', '26.12.1', '24.22.1-rc.1', 'garbage'])('rejects runtime %s outside the chosen patched line', version => {
  expect(isSupportedNode(version)).toBe(false);
  expect(() => assertNodeRuntime(version)).toThrow('restart the actual service process');
});

test.each(['24.22.1', 'v24.22.1', '24.22.2', '24.23.0'])('accepts patched Node 24 runtime %s', version => {
  expect(isSupportedNode(version)).toBe(true);
});
