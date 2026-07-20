const test = require('node:test');
const assert = require('node:assert/strict');

const { VaultTransitionGate } = require('../dist/main/vault-transition.js');

test('vault access is denied for the entire transition and nested opens are rejected', () => {
  const gate = new VaultTransitionGate();
  assert.equal(gate.canAccess('/vault/a'), true);
  assert.equal(gate.begin(), true);
  assert.equal(gate.begin(), false);
  assert.equal(gate.canAccess('/vault/a'), false);
  gate.finish();
  assert.equal(gate.canAccess('/vault/b'), true);
});
