const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildWikiIndex } = require('../dist/main/wiki-index.js');

function makeVault(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-wiki-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Atlas'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Ops'), { recursive: true });
  return { root, vault };
}

test('wikilink indexing has a hard entry limit', async (t) => {
  const { vault } = makeVault(t);
  for (const name of ['one.md', 'two.md', 'three.md']) {
    fs.writeFileSync(path.join(vault, 'Atlas', name), name);
  }

  const index = await buildWikiIndex(vault, 2);
  assert.equal(index.size, 2);
});

test('wikilink indexing rejects a symlinked root outside the vault', async (t) => {
  const { root, vault } = makeVault(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret-title.md'), 'outside');
  try {
    fs.symlinkSync(outside, path.join(vault, 'Raw'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }

  const index = await buildWikiIndex(vault);
  assert.equal(index.has('secret-title'), false);
});
