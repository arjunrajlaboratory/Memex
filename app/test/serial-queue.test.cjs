const test = require('node:test');
const assert = require('node:assert/strict');

const { SerialQueue } = require('../dist/main/serial-queue.js');

test('serial queues preserve task order and recover after a rejection', async () => {
  const queue = new SerialQueue();
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const first = queue.run(async () => { events.push('first-start'); await gate; events.push('first-end'); });
  const failed = queue.run(async () => { events.push('failed'); throw new Error('expected'); });
  const last = queue.run(async () => { events.push('last'); return 42; });
  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  release();

  await first;
  await assert.rejects(failed, /expected/);
  assert.equal(await last, 42);
  assert.deepEqual(events, ['first-start', 'first-end', 'failed', 'last']);
});
