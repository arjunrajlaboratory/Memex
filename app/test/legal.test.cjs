const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LEGAL_DIST = path.join(__dirname, '..', 'dist', 'legal');

test('the build bundles the legal documents into dist/legal', () => {
  for (const file of ['manifest.json', 'terms.md', 'privacy.md']) {
    assert.ok(fs.existsSync(path.join(LEGAL_DIST, file)), `dist/legal/${file} must exist after a build`);
  }
});

test('the bundled manifest declares a version and effective date', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(LEGAL_DIST, 'manifest.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+$/);
  assert.match(manifest.effective, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof manifest.summary, 'string');
});

test('the bundled documents are the real ones, not placeholders', () => {
  const terms = fs.readFileSync(path.join(LEGAL_DIST, 'terms.md'), 'utf8');
  const privacy = fs.readFileSync(path.join(LEGAL_DIST, 'privacy.md'), 'utf8');
  assert.match(terms, /# Memex Desktop Terms of Use/);
  assert.match(privacy, /# Memex Desktop Privacy Notice/);
  // The Anthropic data-flow disclosure is the reason this gate exists.
  assert.match(terms, /Anthropic/);
});

const os = require('node:os');
const { loadLegal, needsAcceptance, acceptanceRecord } = require('../dist/main/legal.js');

const MANIFEST = { version: '1.0', effective: '2026-07-26', summary: '' };

function tempLegalDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-legal-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('loadLegal reads the manifest and both documents', () => {
  const dir = tempLegalDir({
    'manifest.json': JSON.stringify({ version: '2.5', effective: '2027-01-01', summary: 'Clarified §4.' }),
    'terms.md': '# Terms\nbody',
    'privacy.md': '# Privacy\nbody',
  });
  const docs = loadLegal(dir);
  assert.deepEqual(docs.manifest, { version: '2.5', effective: '2027-01-01', summary: 'Clarified §4.' });
  assert.match(docs.terms, /# Terms/);
  assert.match(docs.privacy, /# Privacy/);
});

test('loadLegal reads the real bundled documents', () => {
  const docs = loadLegal(LEGAL_DIST);
  assert.ok(docs);
  assert.match(docs.terms, /Memex Desktop Terms of Use/);
});

test('loadLegal returns null when anything is missing or unusable', () => {
  assert.equal(loadLegal(path.join(os.tmpdir(), 'memex-legal-does-not-exist')), null);
  assert.equal(loadLegal(tempLegalDir({ 'manifest.json': '{ not json' })), null);
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ version: '1.0' }),
  })), null, 'a manifest without documents is unusable');
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ effective: '2026-07-26' }),
    'terms.md': 'x', 'privacy.md': 'x',
  })), null, 'a manifest without a version is unusable');
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ version: '1.0' }),
    'terms.md': '   ', 'privacy.md': 'x',
  })), null, 'an empty document is unusable');
});

test('needsAcceptance is true on a first run', () => {
  assert.equal(needsAcceptance(undefined, MANIFEST), true);
});

test('needsAcceptance is false once the current version is accepted', () => {
  assert.equal(needsAcceptance({ version: '1.0', acceptedAt: 'x', appVersion: '0.1.4' }, MANIFEST), false);
});

test('needsAcceptance is true when the terms version changed', () => {
  assert.equal(needsAcceptance({ version: '1.0', acceptedAt: 'x', appVersion: '0.1.4' }, { ...MANIFEST, version: '1.1' }), true);
  // Plain inequality, not a semver comparison: a rollback re-prompts too.
  assert.equal(needsAcceptance({ version: '2.0', acceptedAt: 'x', appVersion: '0.9.0' }, MANIFEST), true);
});

test('needsAcceptance fails closed on a malformed record or missing manifest', () => {
  assert.equal(needsAcceptance(null, MANIFEST), true);
  assert.equal(needsAcceptance('1.0', MANIFEST), true);
  assert.equal(needsAcceptance({}, MANIFEST), true);
  assert.equal(needsAcceptance({ version: 42 }, MANIFEST), true);
  assert.equal(needsAcceptance({ version: '  ' }, MANIFEST), true);
  assert.equal(needsAcceptance({ version: '1.0' }, null), true, 'no manifest means show the gate');
  assert.equal(needsAcceptance({ version: '1.0' }, { version: '', effective: '', summary: '' }), true);
});

test('acceptanceRecord stamps the version, time, and app version', () => {
  const rec = acceptanceRecord(MANIFEST, '0.1.4', new Date('2026-07-26T12:00:00.000Z'));
  assert.deepEqual(rec, { version: '1.0', acceptedAt: '2026-07-26T12:00:00.000Z', appVersion: '0.1.4' });
  assert.equal(needsAcceptance(rec, MANIFEST), false, 'a fresh record satisfies the gate');
});
