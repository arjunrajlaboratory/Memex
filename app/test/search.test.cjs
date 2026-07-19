const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { searchVault } = require('../dist/main/search.js');

function makeVault(t) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-search-'));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
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
