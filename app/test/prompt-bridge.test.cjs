const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../dist/shared/prompt-bridge.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return (expr) => vm.runInContext(expr, context);
}

const run = load();
const parse = (data) => JSON.parse(JSON.stringify(run('parsePromptBridgeMessage')(data)));
const merge = (draft, text) => run('mergePromptIntoDraft')(draft, text);

test('bridge constants match the briefing review contract', () => {
  assert.equal(run('PROMPT_BRIDGE_TYPE'), 'memex:sendPrompt');
  assert.equal(run('PROMPT_BRIDGE_ACK_TYPE'), 'memex:sendPrompt:ack');
  assert.equal(run('PROMPT_BRIDGE_MAX_CHARS'), 200000);
});

test('non-bridge messages are ignored', () => {
  for (const data of [null, undefined, 'memex:sendPrompt', 42, [], {}, { type: 'other', text: 'x' }, { type: 'memex:sendPrompt:ack', ok: true }]) {
    assert.deepEqual(parse(data), { kind: 'ignore' }, JSON.stringify(data));
  }
});

test('a valid bridge message is accepted with normalized text', () => {
  assert.deepEqual(
    parse({ type: 'memex:sendPrompt', text: '\r\nBriefing review — 2026-11-12\r\n- [3] DONE — x\r\n\n' }),
    { kind: 'accept', text: 'Briefing review — 2026-11-12\n- [3] DONE — x' },
  );
});

test('bridge messages with unusable text are rejected', () => {
  assert.equal(parse({ type: 'memex:sendPrompt' }).kind, 'reject');
  assert.equal(parse({ type: 'memex:sendPrompt', text: 12 }).kind, 'reject');
  assert.equal(parse({ type: 'memex:sendPrompt', text: '   \n ' }).kind, 'reject');
  assert.equal(parse({ type: 'memex:sendPrompt', text: 'x'.repeat(200001) }).kind, 'reject');
  assert.equal(parse({ type: 'memex:sendPrompt', text: 'x'.repeat(200000) }).kind, 'accept');
});

test('only a listed frame window is a trusted source', () => {
  const find = run('findPromptBridgeFrame');
  const a = { contentWindow: { name: 'a' } };
  const b = { contentWindow: { name: 'b' } };
  const detached = { contentWindow: null };
  assert.equal(find(b.contentWindow, [a, b]), b);
  assert.equal(find({ name: 'a' }, [a, b]), null);
  assert.equal(find(null, [detached]), null);
  assert.equal(find(undefined, [detached]), null);
  assert.equal(find(a.contentWindow, []), null);
});

test('staged text replaces an empty draft and follows an existing one after a blank line', () => {
  assert.equal(merge('', 'Briefing review'), 'Briefing review');
  assert.equal(merge('  \n', 'Briefing review'), 'Briefing review');
  assert.equal(merge('Also check the inbox\n\n\n', 'Briefing review'), 'Also check the inbox\n\nBriefing review');
  assert.equal(merge('draft', '  '), 'draft');
});

test('submitting the same text twice does not duplicate it', () => {
  const once = merge('note', 'Briefing review — 2026-11-12');
  assert.equal(merge(once, 'Briefing review — 2026-11-12'), once);
});

const gate = (g) => JSON.parse(JSON.stringify(run('checkPromptBridgeGate')(g)));

test('a prompt is accepted only from a focused frame or right after a user gesture', () => {
  const base = { frameFocused: false, recentActivation: false, lastStagedAt: null, now: 10_000 };
  assert.equal(gate(base).ok, false);
  assert.match(gate(base).error, /not focused/);
  assert.deepEqual(gate({ ...base, frameFocused: true }), { ok: true });
  assert.deepEqual(gate({ ...base, recentActivation: true }), { ok: true });
});

test('one staged prompt per frame every few seconds', () => {
  assert.equal(run('PROMPT_BRIDGE_MIN_INTERVAL_MS'), 3000);
  const g = { frameFocused: true, recentActivation: false, now: 10_000 };
  const limited = gate({ ...g, lastStagedAt: 8_000 });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /too many/);
  assert.deepEqual(gate({ ...g, lastStagedAt: 7_000 }), { ok: true });
  assert.deepEqual(gate({ ...g, lastStagedAt: null }), { ok: true });
});

test('a non-empty draft is never overwritten or re-focused: the text waits behind Insert', () => {
  const mode = run('promptBridgeStageMode');
  assert.equal(mode(''), 'insert');
  assert.equal(mode('  \n'), 'insert');
  assert.equal(mode('half-typed message'), 'confirm');
});
