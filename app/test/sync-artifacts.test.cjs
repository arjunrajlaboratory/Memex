const test = require('node:test');
const assert = require('node:assert/strict');

const { isSyncArtifact } = require('../dist/main/sync-artifacts.js');

test('flags Dropbox, Syncthing, and iCloud sync noise', () => {
  assert.equal(isSyncArtifact('plan (conflicted copy 2026-07-21).md'), true);
  assert.equal(isSyncArtifact("task (Arjun's conflicted copy).md"), true);
  assert.equal(isSyncArtifact('Notes (Case Conflict 1).md'), true);
  assert.equal(isSyncArtifact('report.sync-conflict-20260721-101112-ABCDEF.md'), true);
  assert.equal(isSyncArtifact('.photo.jpg.icloud'), true);
});

test('leaves ordinary vault files alone', () => {
  assert.equal(isSyncArtifact('task.md'), false);
  assert.equal(isSyncArtifact('copy of plan.md'), false);
  assert.equal(isSyncArtifact('conflicted-thoughts.md'), false);
});
