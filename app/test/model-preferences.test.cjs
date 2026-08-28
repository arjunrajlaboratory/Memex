const test = require('node:test');
const assert = require('node:assert/strict');

const { setVaultModel, vaultModel } = require('../dist/main/model-preferences.js');

test('model choices survive config round trips and stay isolated by vault', () => {
  const vaultA = '/vaults/a';
  const vaultB = '/vaults/b';
  const initial = { recent: [vaultA, vaultB] };
  const chosen = setVaultModel(initial, vaultA, 'sonnet');
  const restored = JSON.parse(JSON.stringify(chosen));

  assert.equal(vaultModel(restored, vaultA), 'sonnet');
  assert.equal(vaultModel(restored, vaultB), null);
  assert.deepEqual(initial, { recent: [vaultA, vaultB] });
});

test('clearing a model affects only the selected vault and is idempotent', () => {
  let config = setVaultModel({}, '/vaults/a', 'opus');
  config = setVaultModel(config, '/vaults/b', 'sonnet');
  const cleared = setVaultModel(config, '/vaults/a', null);

  assert.equal(vaultModel(cleared, '/vaults/a'), null);
  assert.equal(vaultModel(cleared, '/vaults/b'), 'sonnet');
  assert.equal(setVaultModel(cleared, '/vaults/a', null), cleared);
  assert.equal(setVaultModel(cleared, '/vaults/b', 'sonnet'), cleared);
});

test('malformed or blank stored values read as no preference', () => {
  assert.equal(vaultModel({}, '/vaults/a'), null);
  assert.equal(vaultModel({ modelByVault: [] }, '/vaults/a'), null);
  assert.equal(vaultModel({ modelByVault: { '/vaults/a': '  ' } }, '/vaults/a'), null);
  assert.equal(vaultModel({ modelByVault: { '/vaults/a': 42 } }, '/vaults/a'), null);
});

test('a whitespace-padded stored value reads back trimmed', () => {
  assert.equal(vaultModel({ modelByVault: { '/vaults/a': ' opus ' } }, '/vaults/a'), 'opus');
});
