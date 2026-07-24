const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SearchContentBudget,
  SEARCH_INDEX_FILE_LIMIT,
  SEARCH_INDEX_TTL_MS,
  SEARCH_QUERY_LIMIT,
  invalidateSearchIndex,
  searchPathAffectsIndex,
  searchVault,
} = require('../dist/main/search.js');

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

function fakeDirectory(entries) {
  return {
    async *[Symbol.asyncIterator]() { yield* entries; },
    async close() {},
  };
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

test('expired indexes refresh even without a watcher event', async (t) => {
  const vault = makeVault(t);
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });

  assert.equal((await searchVault(vault, 'ttl fallback')).content.length, 0);
  fs.writeFileSync(path.join(vault, 'Atlas/ttl-note.md'), 'The ttl fallback refreshed this note.\n');
  now += SEARCH_INDEX_TTL_MS + 1;

  const refreshed = await searchVault(vault, 'ttl fallback');
  assert.equal(refreshed.content.length, 1);
  assert.equal(refreshed.content[0].rel, 'Atlas/ttl-note.md');
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

test('a pathname replacement after open cannot change the file being searched', async (t) => {
  const vault = makeVault(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-search-race-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const target = path.join(vault, 'Atlas/race.md');
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(target, 'ordinary in-vault content\n');
  fs.writeFileSync(secret, 'off-vault replacement canary\n');

  const originalRealpath = fs.promises.realpath;
  let replaced = false;
  fs.promises.realpath = async (...args) => {
    const resolved = await originalRealpath(...args);
    if (!replaced && path.resolve(String(args[0])) === target) {
      replaced = true;
      fs.renameSync(target, target + '.original');
      try {
        fs.symlinkSync(secret, target, 'file');
      } catch (error) {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          fs.renameSync(target + '.original', target);
          t.skip('file symlinks are not permitted on this platform');
        } else {
          throw error;
        }
      }
    }
    return resolved;
  };
  t.after(() => { fs.promises.realpath = originalRealpath; });

  const res = await searchVault(vault, 'off-vault replacement canary');
  assert.equal(replaced, true);
  assert.deepEqual(res.files, []);
  assert.deepEqual(res.content, []);
});

test('content that grows beyond the byte cap after stat is not indexed', async (t) => {
  const vault = makeVault(t);
  const target = path.join(vault, 'Atlas/growing.md');
  fs.writeFileSync(target, 'x'.repeat(999_999));
  const originalOpen = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(String(args[0])) === target) {
      const originalStat = handle.stat.bind(handle);
      handle.stat = async (...statArgs) => {
        const stat = await originalStat(...statArgs);
        fs.appendFileSync(target, 'overlimit-canary');
        return stat;
      };
    }
    return handle;
  };
  t.after(() => { fs.promises.open = originalOpen; });

  const res = await searchVault(vault, 'overlimit-canary');
  assert.deepEqual(res.files, []);
  assert.deepEqual(res.content, []);
});

test('queries are bounded before matching', async (t) => {
  const vault = makeVault(t);
  const res = await searchVault(vault, 'x'.repeat(SEARCH_QUERY_LIMIT + 50));
  assert.equal(res.query.length, SEARCH_QUERY_LIMIT);
});

test('watcher filtering ignores infrastructure but includes custom knowledge paths', () => {
  assert.equal(searchPathAffectsIndex('_schemas/task.md'), false);
  assert.equal(searchPathAffectsIndex('quartz/public/index.html'), false);
  assert.equal(searchPathAffectsIndex('.git/index'), false);
  assert.equal(searchPathAffectsIndex('outputs/quartz-serve.log'), false);
  assert.equal(searchPathAffectsIndex('CV/variants/academic.md'), true);
});

test('search candidate walks stop at the configured file limit', async (t) => {
  const vault = makeVault(t);
  const originalOpendir = fs.promises.opendir;
  fs.promises.opendir = async (requested, options) => {
    if (path.resolve(String(requested)) !== path.resolve(vault)) return originalOpendir(requested, options);
    return fakeDirectory(Array.from({ length: SEARCH_INDEX_FILE_LIMIT + 1 }, (_, index) => ({
      name: `synthetic-${index}.txt`, isDirectory: () => false, isFile: () => true,
    })));
  };
  t.after(() => { fs.promises.opendir = originalOpendir; });

  invalidateSearchIndex(vault);
  assert.equal((await searchVault(vault, `synthetic-${SEARCH_INDEX_FILE_LIMIT - 1}`)).files.length, 1);
  invalidateSearchIndex(vault);
  assert.equal((await searchVault(vault, `synthetic-${SEARCH_INDEX_FILE_LIMIT}`)).files.length, 0);
});

test('search walk budget also counts directories', async (t) => {
  const vault = makeVault(t);
  const originalOpendir = fs.promises.opendir;
  let calls = 0;
  fs.promises.opendir = async (requested) => {
    calls += 1;
    if (path.resolve(String(requested)) !== path.resolve(vault)) return fakeDirectory([]);
    return fakeDirectory(Array.from({ length: SEARCH_INDEX_FILE_LIMIT + 1 }, (_, index) => ({
      name: `synthetic-dir-${index}`, isDirectory: () => true, isFile: () => false,
    })));
  };
  t.after(() => { fs.promises.opendir = originalOpendir; });

  invalidateSearchIndex(vault);
  await searchVault(vault, 'nothing');
  assert.equal(calls, SEARCH_INDEX_FILE_LIMIT); // root plus only the bounded child walks
});

test('search content storage honors a cumulative byte budget', () => {
  const budget = new SearchContentBudget(10);
  assert.equal(budget.remainingBytes, 10);
  assert.equal(budget.take(6), true);
  assert.equal(budget.take(4), true);
  assert.equal(budget.take(1), false);
  assert.equal(budget.remainingBytes, 0);
});
