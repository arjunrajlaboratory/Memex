const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MAX_INBOX_NOTE_BYTES, copyPathsIntoInbox, writeInboxNote } = require('../dist/main/inbox.js');

function makeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-inbox-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(vault, 'Inbox'), { recursive: true });
  fs.mkdirSync(outside);
  return { root, vault, outside };
}

test('Inbox writes reject a directory symlink outside the vault', async (t) => {
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
  assert.equal(await copyPathsIntoInbox(vault, [source]), null);
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

test('quick notes reject content above their byte budget', (t) => {
  const { vault } = makeTree(t);
  assert.equal(writeInboxNote(vault, 'x'.repeat(MAX_INBOX_NOTE_BYTES + 1)), null);
  assert.deepEqual(fs.readdirSync(path.join(vault, 'Inbox')), []);
});

test('ordinary files still copy into a validated Inbox', async (t) => {
  const { root, vault } = makeTree(t);
  const source = path.join(root, 'capture.txt');
  fs.writeFileSync(source, 'capture');

  assert.deepEqual(await copyPathsIntoInbox(vault, [source]), ['capture.txt']);
  assert.equal(fs.readFileSync(path.join(vault, 'Inbox/capture.txt'), 'utf8'), 'capture');
});

test('file drops do not follow a dangling destination symlink', async (t) => {
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

  assert.deepEqual(await copyPathsIntoInbox(vault, [source]), ['capture-1.txt']);
  assert.equal(fs.existsSync(outsideTarget), false);
  assert.equal(fs.readFileSync(path.join(vault, 'Inbox/capture-1.txt'), 'utf8'), 'capture');
});

test('file drops avoid synchronous bulk I/O on the Electron main thread', async (t) => {
  const { root, vault } = makeTree(t);
  const source = path.join(root, 'capture.txt');
  fs.writeFileSync(source, Buffer.alloc(256 * 1024, 0x61));

  const readSync = fs.readSync;
  const writeSync = fs.writeSync;
  const cpSync = fs.cpSync;
  fs.readSync = () => { throw new Error('synchronous read used'); };
  fs.writeSync = () => { throw new Error('synchronous write used'); };
  fs.cpSync = () => { throw new Error('synchronous copy used'); };
  t.after(() => {
    fs.readSync = readSync;
    fs.writeSync = writeSync;
    fs.cpSync = cpSync;
  });

  assert.deepEqual(await copyPathsIntoInbox(vault, [source]), ['capture.txt']);
  assert.equal(fs.statSync(path.join(vault, 'Inbox/capture.txt')).size, 256 * 1024);
});

test('failed file copies do not leave a partial Inbox entry', async (t) => {
  const { root, vault } = makeTree(t);
  const source = path.join(root, 'capture.txt');
  fs.writeFileSync(source, 'capture');
  const canonicalSource = fs.realpathSync(source);

  const open = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await open(...args);
    if (path.resolve(String(args[0])) === canonicalSource) {
      return {
        stat: handle.stat.bind(handle),
        read: async () => { throw new Error('simulated source read failure'); },
        close: handle.close.bind(handle),
      };
    }
    return handle;
  };
  t.after(() => { fs.promises.open = open; });

  assert.deepEqual(await copyPathsIntoInbox(vault, [source]), []);
  assert.equal(fs.existsSync(path.join(vault, 'Inbox/capture.txt')), false);
});

test('directory drops do not import nested symlinks', async (t) => {
  const { root, vault, outside } = makeTree(t);
  const source = path.join(root, 'folder');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'ordinary.txt'), 'ordinary');
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'outside');
  try {
    fs.symlinkSync(secret, path.join(source, 'escape.txt'), 'file');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }

  assert.deepEqual(await copyPathsIntoInbox(vault, [source]), ['folder']);
  assert.equal(fs.readFileSync(path.join(vault, 'Inbox/folder/ordinary.txt'), 'utf8'), 'ordinary');
  assert.equal(fs.existsSync(path.join(vault, 'Inbox/folder/escape.txt')), false);
});
