const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { invalidateSearchIndex, searchPathAffectsIndex, searchVault } = require('../dist/main/search.js');

function makeVault(t) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-search-'));
  t.after(() => {
    invalidateSearchIndex(vault);
    fs.rmSync(vault, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(vault, 'Ops/Tasks'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Atlas'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_schemas'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Ops/Tasks/write-cycle-33-justification.md'),
    '---\ntitle: Write the technical justification\ndescription: Cycle 33 proposal blocker\n---\nNeeds the exposure calculator.\n');
  fs.writeFileSync(path.join(vault, 'Atlas/telescope-notes.md'),
    '---\ntitle: Telescope notes\n---\nThe NIRCam background systematic near bright sources.\n');
  fs.writeFileSync(path.join(vault, '_schemas/cycle.md'), '---\ntitle: cycle schema\n---\ncycle cycle cycle\n');
  return vault;
}

test('title and filename matches land in files tier, ranked above substring', async (t) => {
  const vault = makeVault(t);
  const res = await searchVault(vault, 'cycle');
  assert.ok(res.files.length >= 1);
  assert.equal(res.files[0].rel, 'Ops/Tasks/write-cycle-33-justification.md');
  // infra dirs (leading underscore) are excluded
  assert.ok(res.files.every((h) => !h.rel.startsWith('_')));
});

test('body text lands in content tier with a snippet', async (t) => {
  const vault = makeVault(t);
  const res = await searchVault(vault, 'nircam');
  assert.equal(res.files.length, 0);
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0].rel, 'Atlas/telescope-notes.md');
  assert.match(res.content[0].snippet, /NIRCam background/);
});

test('short or empty queries return nothing', async (t) => {
  const vault = makeVault(t);
  assert.deepEqual((await searchVault(vault, 'c')).files, []);
  assert.deepEqual((await searchVault(vault, '  ')).content, []);
});

test('cached indexes update only after watcher invalidation', async (t) => {
  const vault = makeVault(t);
  assert.equal((await searchVault(vault, 'freshly indexed')).content.length, 0);

  fs.writeFileSync(path.join(vault, 'Atlas/new-note.md'), 'A freshly indexed search result.\n');
  assert.equal((await searchVault(vault, 'freshly indexed')).content.length, 0);

  invalidateSearchIndex(vault);
  const refreshed = await searchVault(vault, 'freshly indexed');
  assert.equal(refreshed.content.length, 1);
  assert.equal(refreshed.content[0].rel, 'Atlas/new-note.md');
});

test('symbolic links cannot add content from outside the vault', async (t) => {
  const vault = makeVault(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-search-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(secret, 'off-vault search canary\n');
  try {
    fs.symlinkSync(secret, path.join(vault, 'Atlas/leaked.md'), 'file');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('file symlinks are not permitted on this platform');
      return;
    }
    throw error;
  }

  const res = await searchVault(vault, 'off-vault search canary');
  assert.deepEqual(res.files, []);
  assert.deepEqual(res.content, []);
});

test('watcher filtering ignores infrastructure but includes custom knowledge paths', () => {
  assert.equal(searchPathAffectsIndex('_schemas/task.md'), false);
  assert.equal(searchPathAffectsIndex('quartz/public/index.html'), false);
  assert.equal(searchPathAffectsIndex('.git/index'), false);
  assert.equal(searchPathAffectsIndex('outputs/quartz-serve.log'), false);
  assert.equal(searchPathAffectsIndex('CV/variants/academic.md'), true);
});
