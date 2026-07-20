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
