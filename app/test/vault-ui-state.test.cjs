const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('vault UI reset clears all session-scoped model state', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/shared/vault-ui-state.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const result = vm.runInContext(`(() => {
    const state = {
      tab: 'artifact', activeAssistant: { raw: 'old vault' },
      toolCards: new Map([['old', {}]]), busy: true, hasArtifact: true,
      history: [{ k: 'art' }], histPos: 0, customTabs: [{}], customChips: [{}],
    };
    resetVaultUiModel(state);
    return { ...state, toolCardCount: state.toolCards.size };
  })()`, context);

  assert.equal(result.tab, 'dashboard');
  assert.equal(result.activeAssistant, null);
  assert.equal(result.toolCardCount, 0);
  assert.equal(result.busy, false);
  assert.equal(result.hasArtifact, false);
  assert.deepEqual(Array.from(result.history), []);
  assert.equal(result.histPos, -1);
  assert.deepEqual(Array.from(result.customTabs), []);
  assert.deepEqual(Array.from(result.customChips), []);
});

test('a failed vault-open request does not advance the committed vault epoch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/shared/vault-ui-state.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const result = vm.runInContext(`(() => {
    const state = { request: 0, epoch: 7 };
    const failedRequest = beginVaultOpen(state);
    const epochAfterFailure = state.epoch;
    const successfulRequest = beginVaultOpen(state);
    const staleCommit = commitVaultOpen(state, failedRequest);
    const committedEpoch = commitVaultOpen(state, successfulRequest);
    return { epochAfterFailure, staleCommit, committedEpoch, state };
  })()`, context);

  assert.equal(result.epochAfterFailure, 7);
  assert.equal(result.staleCommit, null);
  assert.equal(result.committedEpoch, 8);
  assert.equal(result.state.epoch, 8);
});
