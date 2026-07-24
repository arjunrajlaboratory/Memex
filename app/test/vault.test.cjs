const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vaultLib = require('../dist/main/vault.js');

function makeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-vault-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(vault, 'Ops/Tasks'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Atlas'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'AGENTS.md'), '# Vault\n');
  fs.mkdirSync(outside);
  return { root, vault, outside };
}

test('ordinary vault files remain readable after real-path validation', (t) => {
  const { vault } = makeTree(t);
  fs.writeFileSync(path.join(vault, 'Atlas/local.md'), 'local note\n');
  assert.equal(vaultLib.isVault(vault), true);
  assert.equal(vaultLib.pathType(vault, 'Atlas/local.md'), 'file');
  assert.equal(vaultLib.readFile(vault, 'Atlas/local.md').content, 'local note\n');
});

test('vault reads reject file and directory symlinks outside the vault', (t) => {
  const { vault, outside } = makeTree(t);
  fs.writeFileSync(path.join(outside, 'secret.md'), 'outside-vault-canary\n');
  fs.mkdirSync(path.join(outside, 'reports'));
  fs.writeFileSync(path.join(outside, 'reports/report.md'), 'outside report\n');

  try {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(vault, 'inside.md'), 'file');
    fs.symlinkSync(path.join(outside, 'reports'), path.join(vault, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }

  assert.equal(vaultLib.readFile(vault, 'inside.md'), null);
  assert.equal(vaultLib.pathType(vault, 'reports'), null);
  assert.deepEqual(vaultLib.listFolder(vault, 'reports'), []);
});

test('a disappearing collection entry is skipped instead of rejecting the collection', (t) => {
  const { vault } = makeTree(t);
  const task = path.join(vault, 'Ops/Tasks/transient.md');
  fs.writeFileSync(task, '---\ntitle: transient\n---\n');
  const realTask = fs.realpathSync(task);
  const originalStat = fs.statSync;
  fs.statSync = (...args) => {
    const requested = path.resolve(String(args[0]));
    if (requested === task || requested === realTask) {
      const error = new Error('gone');
      error.code = 'ENOENT';
      throw error;
    }
    return originalStat(...args);
  };
  const vaultModule = require.resolve('../dist/main/vault.js');
  delete require.cache[vaultModule];
  const patchedVaultLib = require(vaultModule);
  t.after(() => {
    fs.statSync = originalStat;
    delete require.cache[vaultModule];
  });

  assert.deepEqual(patchedVaultLib.readTasks(vault), []);
});

test('display reads reject files larger than their content limit', (t) => {
  const { vault } = makeTree(t);
  const oversized = path.join(vault, 'outputs/oversized.txt');
  fs.writeFileSync(oversized, 'small');
  fs.truncateSync(oversized, vaultLib.MAX_TEXT_FILE_BYTES + 1);

  assert.equal(vaultLib.readFile(vault, 'outputs/oversized.txt'), null);
});

test('vault collection content budgets are cumulative', () => {
  const budget = new vaultLib.VaultContentBudget(10);
  assert.equal(budget.take(6), true);
  assert.equal(budget.take(4), true);
  assert.equal(budget.take(1), false);
});
