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

test('a single artifact cannot exceed the configured byte budget', () => {
  const store = new ArtifactStore(200, () => 'artifact-id', 8);

  assert.equal(store.register('/vault/a', '12345678'), 'artifact-id');
  assert.equal(store.register('/vault/a', '123456789'), null);
  assert.equal(store.register('/vault/a', 'ééééé'), null);
});

test('artifact eviction also enforces the cumulative byte budget', () => {
  let nextId = 0;
  const store = new ArtifactStore(200, () => `artifact-${++nextId}`, 8, 10);

  const evicted = store.register('/vault/a', '123456');
  const retained = store.register('/vault/a', 'abcdef');
  assert.equal(store.get(evicted), null);
  assert.equal(store.get(retained), 'abcdef');
  assert.equal(store.register('/vault/a', '123456789'), null);
});
