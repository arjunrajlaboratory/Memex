const test = require('node:test');
const assert = require('node:assert/strict');

const { localDatePlusDays, localDateString } = require('../dist/main/date.js');

test('localDateString keeps the local calendar day late at night', () => {
  const localLateNight = new Date(2026, 6, 18, 23, 45, 0);
  assert.equal(localDateString(localLateNight), '2026-07-18');
});

test('localDatePlusDays crosses month boundaries as calendar days', () => {
  const localNoon = new Date(2026, 6, 31, 12, 0, 0);
  assert.equal(localDatePlusDays(1, localNoon), '2026-08-01');
});
