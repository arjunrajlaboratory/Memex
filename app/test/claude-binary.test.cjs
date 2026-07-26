const test = require('node:test');
const assert = require('node:assert/strict');

const { unpackedClaudeBinaryPath } = require('../dist/main/claude-binary.js');

// Regression: 0.1.1 shipped pointing at the in-asar path and every packaged
// session died with "spawn ENOTDIR". The path must land in app.asar.unpacked.
test('resolves the unpacked binary, never a path through app.asar', () => {
  const p = unpackedClaudeBinaryPath('/Apps/Memex.app/Contents/Resources', 'darwin', 'arm64');
  assert.equal(
    p,
    '/Apps/Memex.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
  );
  assert.ok(!/app\.asar\//.test(p.replace('app.asar.unpacked', '')), 'must not traverse app.asar');
});

test('picks the platform-specific package and executable name', () => {
  assert.match(
    unpackedClaudeBinaryPath('/r', 'darwin', 'x64'),
    /@anthropic-ai\/claude-agent-sdk-darwin-x64\/claude$/,
  );
  assert.match(
    unpackedClaudeBinaryPath('/r', 'linux', 'x64'),
    /@anthropic-ai\/claude-agent-sdk-linux-x64\/claude$/,
  );
  // Windows needs the .exe suffix or spawn cannot find it.
  assert.match(
    unpackedClaudeBinaryPath('/r', 'win32', 'x64'),
    /@anthropic-ai\/claude-agent-sdk-win32-x64\/claude\.exe$/,
  );
});
