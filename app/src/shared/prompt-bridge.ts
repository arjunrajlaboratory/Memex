// Pure helpers for the artifact → chat-composer bridge. Compiled as a plain
// browser-global script (like area-batch.ts) so the renderer can use it from a
// <script> tag and the tests can load it into a vm context without Electron.
//
// An artifact page asks the app to stage a prompt with
//   window.parent.postMessage({ type: 'memex:sendPrompt', text }, '*')
// The renderer only ever places the text in the composer; the user sends it.

const PROMPT_BRIDGE_TYPE = 'memex:sendPrompt';
const PROMPT_BRIDGE_ACK_TYPE = 'memex:sendPrompt:ack';
const PROMPT_BRIDGE_MAX_CHARS = 200_000;

type PromptBridgeResult =
  | { kind: 'ignore' }                    // not a bridge message at all
  | { kind: 'reject'; error: string }     // a bridge message with an unusable payload
  | { kind: 'accept'; text: string };

/** Classify an incoming postMessage payload; only `accept` carries text to stage. */
function parsePromptBridgeMessage(data: unknown): PromptBridgeResult {
  if (!data || typeof data !== 'object') return { kind: 'ignore' };
  const message = data as { type?: unknown; text?: unknown };
  if (message.type !== PROMPT_BRIDGE_TYPE) return { kind: 'ignore' };
  if (typeof message.text !== 'string') return { kind: 'reject', error: 'text must be a string' };
  if (message.text.length > PROMPT_BRIDGE_MAX_CHARS) return { kind: 'reject', error: 'text is too long' };
  const text = message.text.replace(/\r\n?/g, '\n').trim();
  if (!text) return { kind: 'reject', error: 'text is empty' };
  return { kind: 'accept', text };
}

/** Return the frame whose window posted the message, or null for any other source. */
function findPromptBridgeFrame<F extends { contentWindow: unknown }>(source: unknown, frames: Iterable<F>): F | null {
  if (!source) return null;
  for (const frame of frames) if (frame.contentWindow === source) return frame;
  return null;
}

/** Minimum gap between two staged prompts from the same artifact frame. */
const PROMPT_BRIDGE_MIN_INTERVAL_MS = 3000;

type PromptBridgeGate = {
  frameFocused: boolean;      // document.activeElement === the sending iframe
  recentActivation: boolean;  // the page saw a user gesture moments ago (navigator.userActivation.isActive)
  lastStagedAt: number | null; // when this frame last had a prompt accepted, or null
  now: number;
};

type PromptBridgeDecision = { ok: true } | { ok: false; error: string };

/**
 * Decide whether an artifact frame may stage a prompt now. An artifact is
 * agent-written HTML: it may hand text to the composer only right after the user
 * interacted with it (its frame has focus, or there was a fresh user gesture),
 * and at most once per PROMPT_BRIDGE_MIN_INTERVAL_MS, so it cannot keep
 * appending to the draft in the background.
 */
function checkPromptBridgeGate(gate: PromptBridgeGate): PromptBridgeDecision {
  if (!gate.frameFocused && !gate.recentActivation) {
    return { ok: false, error: 'the artifact is not focused; click its button again' };
  }
  if (gate.lastStagedAt !== null && gate.now - gate.lastStagedAt < PROMPT_BRIDGE_MIN_INTERVAL_MS) {
    return { ok: false, error: 'too many requests; wait a few seconds and try again' };
  }
  return { ok: true };
}

/**
 * How to stage accepted text: straight into an empty composer ('insert'), or —
 * when the user already has a draft they may be typing — behind an explicit
 * Insert button ('confirm'), so focus and caret are never taken from them and
 * their next Enter cannot send text they did not see arrive.
 */
function promptBridgeStageMode(draft: string): 'insert' | 'confirm' {
  return String(draft || '').trim() ? 'confirm' : 'insert';
}

/**
 * Append staged text to the composer's draft after a blank line. A draft that
 * already ends with the same text (a double-clicked Submit) is left unchanged.
 */
function mergePromptIntoDraft(draft: string, text: string): string {
  const head = String(draft || '').replace(/\s+$/, '');
  const addition = String(text || '').trim();
  if (!addition) return head;
  if (!head) return addition;
  if (head.endsWith(addition)) return head;
  return head + '\n\n' + addition;
}
