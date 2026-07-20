const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { classifyVaultChange } = require('../dist/main/watch-policy.js');

test('root watcher changes refresh custom tabs and all wikilink roots', () => {
  assert.deepEqual(classifyVaultChange('CV/variants/academic.md'), {
    area: 'custom', invalidateSearch: true, invalidateWiki: false,
  });
  assert.deepEqual(classifyVaultChange('Raw/new-source.md'), {
    area: 'custom', invalidateSearch: true, invalidateWiki: true,
  });
  assert.deepEqual(classifyVaultChange('Drafts/report.md'), {
    area: 'custom', invalidateSearch: true, invalidateWiki: true,
  });
  assert.equal(classifyVaultChange('_schemas/task.md').invalidateSearch, false);
});

test('area batches retain every distinct area in a burst', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/shared/area-batch.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const result = vm.runInContext(`(() => {
    const batch = new AreaBatch();
    batch.add('tasks'); batch.add('config'); batch.add('tasks');
    return batch.drain();
  })()`, context);
  assert.deepEqual(Array.from(result), ['tasks', 'config']);
});
