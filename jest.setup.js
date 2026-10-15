const { TextDecoder, TextEncoder } = require('node:util');
const { setImmediate: nodeSetImmediate, clearImmediate: nodeClearImmediate } = require('node:timers');

global.TextDecoder ??= TextDecoder;
global.TextEncoder ??= TextEncoder;
global.setImmediate ??= nodeSetImmediate;
global.clearImmediate ??= nodeClearImmediate;
