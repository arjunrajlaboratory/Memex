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
