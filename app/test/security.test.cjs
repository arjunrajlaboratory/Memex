const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { isSafeExternalUrl, isTrustedFileUrl, resolveInside } = require('../dist/main/security.js');

test('external navigation accepts only HTTP(S)', () => {
  assert.equal(isSafeExternalUrl('https://example.com/report'), true);
  assert.equal(isSafeExternalUrl('http://localhost:8137/'), true);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('data:text/html,hello'), false);
});

test('trusted renderer URL must be the exact local entry point', () => {
  const renderer = path.resolve('/tmp/memex renderer/index.html');
  assert.equal(isTrustedFileUrl(pathToFileURL(renderer).href + '#dashboard', renderer), true);
  assert.equal(isTrustedFileUrl(pathToFileURL(path.resolve('/tmp/other.html')).href, renderer), false);
  assert.equal(isTrustedFileUrl('https://example.com/', renderer), false);
});

test('vault paths cannot traverse or replace their base', () => {
  const vault = path.resolve('/tmp/example-vault');
  assert.equal(resolveInside(vault, 'outputs/report.md'), path.join(vault, 'outputs/report.md'));
  assert.equal(resolveInside(vault, '../secret.txt'), null);
  assert.equal(resolveInside(vault, path.resolve('/tmp/secret.txt')), null);
});
