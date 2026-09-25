const test = require('node:test');
const assert = require('node:assert/strict');

const { ASK_USER_TOOL, PendingQuestions, answeredInput, hasAnyAnswer, parseQuestions } = require('../dist/main/ask-user.js');

const input = {
  questions: [
    { question: 'Which theme?', header: 'Theme', multiSelect: false,
      options: [{ label: 'Dark', description: 'Low light' }, { label: 'Light', description: 'Paper', preview: 'x' }] },
    { question: 'Which tabs?', header: 'Tabs', multiSelect: true,
      options: [{ label: 'Tasks', description: '' }, { label: 'Ideas', description: '' }] },
  ],
};

test('the tool name matches the SDK built-in', () => {
  assert.equal(ASK_USER_TOOL, 'AskUserQuestion');
});

test('parseQuestions keeps valid questions and rejects malformed input', () => {
  const qs = parseQuestions(input);
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[0].options[1], { label: 'Light', description: 'Paper', preview: 'x' });
  assert.equal(qs[1].multiSelect, true);
  assert.equal(parseQuestions({}), null);
  assert.equal(parseQuestions({ questions: [] }), null);
  assert.equal(parseQuestions({ questions: [{ header: 'x', options: [] }] }), null);
  assert.equal(parseQuestions({ questions: [null] }), null);
});

test('answeredInput adds answers keyed by question text, comma-joining multi-select', () => {
  const qs = parseQuestions(input);
  const out = answeredInput(input, qs, { 'Which theme?': 'Light', 'Which tabs?': ['Tasks', ' Ideas '] });
  assert.equal(out.questions, input.questions);
  assert.deepEqual(out.answers, { 'Which theme?': 'Light', 'Which tabs?': 'Tasks, Ideas' });
});

test('answeredInput drops blank, unknown and non-string picks', () => {
  const qs = parseQuestions(input);
  const out = answeredInput(input, qs, { 'Which theme?': '  ', 'Which tabs?': [3, ''], 'Unasked?': 'x' });
  assert.deepEqual(out.answers, {});
  assert.equal(hasAnyAnswer(qs, { 'Which theme?': '  ' }), false);
  assert.equal(hasAnyAnswer(qs, null), false);
  assert.equal(hasAnyAnswer(qs, { 'Which theme?': 'My own answer' }), true);
});

test('PendingQuestions resolves each question once and cancels the rest', async () => {
  const pending = new PendingQuestions();
  const a = pending.wait('a');
  const b = pending.wait('b');
  assert.equal(pending.answer('a', { q: 'x' }), true);
  assert.equal(pending.answer('a', { q: 'y' }), false);
  assert.deepEqual(await a, { q: 'x' });
  assert.deepEqual(pending.cancelAll(), ['b']);
  assert.equal(await b, null);
  assert.equal(pending.size, 0);
  assert.equal(pending.answer('missing', null), false);
});
