const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { copyPathsIntoInbox, writeInboxNote } = require('../dist/main/inbox.js');

function makeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-inbox-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(vault, 'Inbox'), { recursive: true });
  fs.mkdirSync(outside);
  return { root, vault, outside };
}

test('Inbox writes reject a directory symlink outside the vault', (t) => {
  const { vault, outside } = makeTree(t);
  fs.rmSync(path.join(vault, 'Inbox'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(vault, 'Inbox'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }
  const source = path.join(path.dirname(vault), 'capture.txt');
  fs.writeFileSync(source, 'capture');

  assert.equal(writeInboxNote(vault, 'private note', new Date('2026-07-19T12:34:56Z')), null);
  assert.equal(copyPathsIntoInbox(vault, [source]), null);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('quick notes do not follow a dangling destination symlink', (t) => {
  const { vault, outside } = makeTree(t);
  const now = new Date('2026-07-19T12:34:56Z');
  const firstName = 'note-2026-07-19T12-34-56.md';
  const outsideTarget = path.join(outside, 'escaped.md');
  try {
    fs.symlinkSync(outsideTarget, path.join(vault, 'Inbox', firstName), 'file');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }

  const rel = writeInboxNote(vault, 'safe note', now);
  assert.equal(rel, path.join('Inbox', 'note-2026-07-19T12-34-56-1.md'));
  assert.equal(fs.existsSync(outsideTarget), false);
  assert.equal(fs.readFileSync(path.join(vault, rel), 'utf8'), 'safe note\n');
});

test('ordinary files still copy into a validated Inbox', (t) => {
  const { root, vault } = makeTree(t);
  const source = path.join(root, 'capture.txt');
  fs.writeFileSync(source, 'capture');

  assert.deepEqual(copyPathsIntoInbox(vault, [source]), ['capture.txt']);
  assert.equal(fs.readFileSync(path.join(vault, 'Inbox/capture.txt'), 'utf8'), 'capture');
});

test('file drops do not follow a dangling destination symlink', (t) => {
  const { root, vault, outside } = makeTree(t);
  const source = path.join(root, 'capture.txt');
  const outsideTarget = path.join(outside, 'escaped.txt');
  fs.writeFileSync(source, 'capture');
  try {
    fs.symlinkSync(outsideTarget, path.join(vault, 'Inbox/capture.txt'), 'file');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }

  assert.deepEqual(copyPathsIntoInbox(vault, [source]), ['capture-1.txt']);
  assert.equal(fs.existsSync(outsideTarget), false);
  assert.equal(fs.readFileSync(path.join(vault, 'Inbox/capture-1.txt'), 'utf8'), 'capture');
});
