const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDesktopTabsDocument,
  tabPreferencesFromDocument,
  withTabPreferences,
  writeDesktopTabsDocument,
} = require('../dist/main/tab-preferences.js');

function makeVault(t) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-tab-prefs-'));
  fs.writeFileSync(path.join(vault, 'AGENTS.md'), '# Vault\n');
  fs.mkdirSync(path.join(vault, 'Atlas/Areas'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Ops/Tasks'), { recursive: true });
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  return vault;
}

test('tab preferences are validated, deduplicated, and preserve unrelated desktop config', () => {
  const original = parseDesktopTabsDocument(JSON.stringify({
    tabs: [{ id: 'cv', label: 'CV', path: 'CV' }],
    chips: [{ label: 'Review', prompt: 'Review this week' }],
    futureSetting: { keep: true },
    navigation: { hidden: ['people'], folders: ['Atlas/Areas'], futureNavigationSetting: true },
  }));
  assert.deepEqual(
    tabPreferencesFromDocument(original, ['dashboard', 'people', 'cv'], ['Atlas/Areas']),
    { hiddenTabs: ['people'], folders: ['Atlas/Areas'] },
  );

  const updated = withTabPreferences(
    original,
    { hiddenTabs: ['dashboard', 'dashboard', 'unknown'], folders: ['Atlas/Areas', '../escape', 'Atlas/Areas'] },
    ['dashboard', 'people', 'cv'],
    ['Atlas/Areas'],
  );
  assert.deepEqual(updated.navigation, { hidden: ['dashboard'], folders: ['Atlas/Areas'], futureNavigationSetting: true });
  assert.deepEqual(updated.tabs, original.tabs);
  assert.deepEqual(updated.chips, original.chips);
  assert.deepEqual(updated.futureSetting, { keep: true });
});

test('hand-edited preferences cannot hide every available tab without selecting a folder', () => {
  assert.deepEqual(
    tabPreferencesFromDocument(
      { navigation: { hidden: ['dashboard', 'people'], folders: [] } },
      ['dashboard', 'people'],
      ['Atlas/Areas'],
    ),
    { hiddenTabs: ['people'], folders: [] },
  );
  assert.deepEqual(
    tabPreferencesFromDocument(
      { navigation: { hidden: ['dashboard', 'people'], folders: ['Atlas/Areas'] } },
      ['dashboard', 'people'],
      ['Atlas/Areas'],
    ),
    { hiddenTabs: ['dashboard', 'people'], folders: ['Atlas/Areas'] },
  );
});

test('desktop tab preferences write to the vault config without dropping existing fields', (t) => {
  const vault = makeVault(t);
  const document = { tabs: [{ label: 'CV', path: 'CV' }], navigation: { hidden: ['ideas'], folders: ['Atlas/Areas'] } };
  assert.equal(writeDesktopTabsDocument(vault, document), true);
  const saved = JSON.parse(fs.readFileSync(path.join(vault, '_config/desktop-tabs.json'), 'utf8'));
  assert.deepEqual(saved, document);
  assert.equal(fs.statSync(path.join(vault, '_config/desktop-tabs.json')).isFile(), true);
  assert.equal(writeDesktopTabsDocument(vault, document), false);
});

test('desktop tab preference writes reject an unsafe config directory symlink', (t) => {
  const vault = makeVault(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-tab-prefs-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  try {
    fs.symlinkSync(outside, path.join(vault, '_config'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symbolic links are not permitted on this platform');
      return;
    }
    throw error;
  }
  assert.throws(() => writeDesktopTabsDocument(vault, { navigation: {} }), /unsafe/);
  assert.equal(fs.existsSync(path.join(outside, 'desktop-tabs.json')), false);
});
