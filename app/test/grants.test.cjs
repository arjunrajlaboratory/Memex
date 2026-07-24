const test = require('node:test');
const assert = require('node:assert/strict');

const { clearVaultToolGrants, grantTool, hasToolGrant } = require('../dist/main/grants.js');

test('tool grants survive config round trips and stay isolated by vault', () => {
  const vaultA = '/vaults/a';
  const vaultB = '/vaults/b';
  const initial = { recent: [vaultA, vaultB] };
  const granted = grantTool(initial, vaultA, 'Bash');
  const restored = JSON.parse(JSON.stringify(granted));

  assert.equal(hasToolGrant(restored, vaultA, 'Bash'), true);
  assert.equal(hasToolGrant(restored, vaultA, 'bash'), false);
  assert.equal(hasToolGrant(restored, vaultB, 'Bash'), false);
  assert.deepEqual(initial, { recent: [vaultA, vaultB] });
});

test('clearing grants affects only the selected vault', () => {
  let config = grantTool({}, '/vaults/a', 'Bash');
  config = grantTool(config, '/vaults/b', 'Bash');
  config = clearVaultToolGrants(config, '/vaults/a');

  assert.equal(hasToolGrant(config, '/vaults/a', 'Bash'), false);
  assert.equal(hasToolGrant(config, '/vaults/b', 'Bash'), true);
});
