const test = require('node:test');
const assert = require('node:assert/strict');

const { ArtifactStore } = require('../dist/main/artifact-store.js');

test('identical artifacts reuse an origin only within the same vault scope', () => {
  let nextId = 0;
  const store = new ArtifactStore(200, () => `artifact-${++nextId}`);

  const first = store.register('/vault/a', '<p>same dashboard</p>');
  assert.equal(store.register('/vault/a', '<p>same dashboard</p>'), first);
  assert.notEqual(store.register('/vault/b', '<p>same dashboard</p>'), first);
});

test('artifact eviction removes the matching scoped dedup entry', () => {
  let nextId = 0;
  const store = new ArtifactStore(1, () => `artifact-${++nextId}`);

  const evicted = store.register('/vault/a', 'first');
  store.register('/vault/a', 'second');
  assert.equal(store.get(evicted), null);
  assert.notEqual(store.register('/vault/a', 'first'), evicted);
});
