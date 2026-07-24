# Desktop Feedback Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Memex work as well for Microsoft 365 users as Google users, keep the desktop artifact panel fresh instead of stale, add a Claude Code hand-off, and make Dropbox-style file-sync a first-class vault choice.

**Architecture:** Two independent halves. App half (TypeScript, `app/`): a sync-artifact ignore predicate threaded through vault scans, a dismissible artifact tab, new copy on the getting-started card, and a new `open_in_claude_code` in-process MCP tool plus system-prompt guidance. Engine half (Python + Markdown, `tools/` + `packs/core/`): a `provider` answer at init that keys per-stream MCP server ids in `_config/sources.md`, a `mailboxes.connected` rename (legacy key still read), provider-scoped prose in skills, and reframed git-mode copy.

**Tech Stack:** Electron + TypeScript (tsc only, `node --test` on compiled `dist/`), Python 3 stdlib (`unittest`), Markdown packs.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-desktop-feedback-round-design.md`.
- Never hardcode guessed Microsoft 365 *tool* names in skills — tool discovery is by server id from `streams.*.mcp` via ToolSearch. The server id `claude_ai_Microsoft_365` is an init-time string the user can correct in `sources.md`.
- Legacy vaults keep working: readers of `mailboxes.gmail_connected` must also accept the old key; new bakes write only `mailboxes.connected`.
- `open_in_claude_code` must NOT be auto-allowed (permission dialog is the confirmation step).
- App tests: `cd app && npm test` (builds first, then `node --test test/*.test.cjs` against `dist/`). Engine tests: `cd tools && python3 -m unittest test_memex_init -v`.
- Commit after each task; commit messages end with the standard `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01CFQsK7bpAmCwrSMpxYM5BC` trailer.
- App working dir for all `npm` commands: `/Users/arjunraj/code/Memex/app`.

---

### Task 1: Sync-artifact ignore predicate (app)

Dropbox/iCloud/Syncthing vaults produce conflict copies and placeholders that must never surface as vault rows, search hits, wiki targets, or watch churn.

**Files:**
- Create: `app/src/main/sync-artifacts.ts`
- Modify: `app/src/main/vault.ts` (collection ~163, readInbox ~275, walk ~298, briefings list ~339), `app/src/main/search.ts:66-70`, `app/src/main/wiki-index.ts:29`, `app/src/main/watch-policy.ts:13`
- Test: `app/test/sync-artifacts.test.cjs`, extend `app/test/watch-policy.test.cjs`

**Interfaces:**
- Produces: `isSyncArtifact(name: string): boolean` from `app/src/main/sync-artifacts.ts` — takes a basename (not a path), returns true for sync-service noise.

- [ ] **Step 1: Write the failing test**

Create `app/test/sync-artifacts.test.cjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/arjunraj/code/Memex/app && npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../dist/main/sync-artifacts.js'`

- [ ] **Step 3: Write the module**

Create `app/src/main/sync-artifacts.ts`:

```ts
// Sync services (Dropbox, iCloud Drive, Syncthing) drop conflict copies and
// placeholder files into synced vaults. They are noise, not content: never
// list, index, wiki-link, or watch-refresh on them.
export function isSyncArtifact(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes(' (conflicted copy') ||       // Dropbox
    lower.includes("'s conflicted copy") ||           // Dropbox (owner-named)
    lower.includes(' (case conflict') ||              // Dropbox case conflicts
    lower.includes('.sync-conflict-') ||              // Syncthing
    lower.endsWith('.icloud');                        // iCloud placeholder
}
```

- [ ] **Step 4: Wire into the four scan sites**

`app/src/main/vault.ts` — add import at top with the other local imports:

```ts
import { isSyncArtifact } from './sync-artifacts';
```

In `collection()` (~line 163), change:

```ts
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    if (ent.name === 'README.md') continue;
```
to:
```ts
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    if (ent.name === 'README.md' || isSyncArtifact(ent.name)) continue;
```

In `readInbox()` (~line 275), change:

```ts
    if (ent.name === 'README.md' || ent.name.startsWith('.') || ent.name === '_filed') continue;
```
to:
```ts
    if (ent.name === 'README.md' || ent.name.startsWith('.') || ent.name === '_filed') continue;
    if (isSyncArtifact(ent.name)) continue;
```

In `walk()` (~line 298), change:

```ts
    if (ent.name.startsWith('.') || ent.name === 'README.md') continue;
```
to:
```ts
    if (ent.name.startsWith('.') || ent.name === 'README.md' || isSyncArtifact(ent.name)) continue;
```

In the briefings listing (~line 339), extend the filter:

```ts
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !isSyncArtifact(e.name) && pathType(vault, path.join('Ops/Briefings', e.name)) === 'file')
```

`app/src/main/search.ts` — add import, then extend `shouldSkipName` (line 66):

```ts
import { isSyncArtifact } from './sync-artifacts';
```
```ts
function shouldSkipName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || name.startsWith('_') || SKIP_DIRS.has(lower) ||
    lower === 'readme.md' || lower.endsWith('.log') || isSyncArtifact(name);
}
```
(`searchPathAffectsIndex` uses `shouldSkipName`, so search-index watch invalidation is covered for free.)

`app/src/main/wiki-index.ts` — add import, then at line 29 change:

```ts
        if (entry.name.startsWith('.') || entry.name === 'README.md') continue;
```
to:
```ts
        if (entry.name.startsWith('.') || entry.name === 'README.md' || isSyncArtifact(entry.name)) continue;
```

`app/src/main/watch-policy.ts` — add import, then at the top of `classifyVaultChange`, right after `const parts = ...`:

```ts
import { isSyncArtifact } from './sync-artifacts';
```
```ts
  // Sync-service noise must not trigger renderer refreshes or cache invalidation.
  if (parts.length && isSyncArtifact(parts[parts.length - 1])) {
    return { area: null, invalidateSearch: false, invalidateWiki: false };
  }
```

- [ ] **Step 5: Extend the watch-policy test**

Append to `app/test/watch-policy.test.cjs`:

```js
test('sync-service conflict files cause no refresh or invalidation', () => {
  assert.deepEqual(classifyVaultChange('Ops/Tasks/task (conflicted copy 2026-07-21).md'), {
    area: null, invalidateSearch: false, invalidateWiki: false,
  });
  assert.deepEqual(classifyVaultChange('Atlas/note.sync-conflict-20260721-101112-ABCDEF.md'), {
    area: null, invalidateSearch: false, invalidateWiki: false,
  });
});
```

- [ ] **Step 6: Run the app test suite**

Run: `cd /Users/arjunraj/code/Memex/app && npm test 2>&1 | tail -20`
Expected: PASS (all suites, including the two new files' tests)

- [ ] **Step 7: Commit**

```bash
git add app/src/main/sync-artifacts.ts app/src/main/vault.ts app/src/main/search.ts app/src/main/wiki-index.ts app/src/main/watch-policy.ts app/test/sync-artifacts.test.cjs app/test/watch-policy.test.cjs
git commit -m "desktop: ignore sync-service conflict files across vault scans"
```

---

### Task 2: Getting-started card names both ecosystems (app)

**Files:**
- Modify: `app/src/renderer/renderer.ts:649-656` (the `gs-connect` block)

**Interfaces:** none (copy-only).

- [ ] **Step 1: Replace the connect-card copy**

In `renderGettingStarted`, replace the `connect.innerHTML` template (currently titled "⚲ Connect Gmail &amp; Calendar") with:

```ts
  connect.innerHTML = `
    <div class="t">⚲ Connect mail &amp; calendar</div>
    <div class="d">Your memex reads mail and calendar through Claude connectors — set up once in your Claude account, not in this app.</div>
    <ol>
      <li>At <a class="gs-ext" data-url="https://claude.ai/customize/connectors">claude.ai → Settings → Connectors</a>, connect your suite — Google (Gmail, Google Calendar, Drive) or Microsoft 365 (Outlook mail &amp; calendar, OneDrive) <span class="dim">(Pro, Max, Team, and Enterprise plans)</span>.</li>
      <li>Sign in to the <span class="mono">claude</span> CLI with that same account — connectors flow into this agent automatically.</li>
      <li>Then ask here: <em>“What sources are connected?”</em> — the agent can check its own tools.</li>
    </ol>`;
```

- [ ] **Step 2: Build**

Run: `cd /Users/arjunraj/code/Memex/app && npm run build`
Expected: clean tsc exit (renderer has no unit tests; the live drive in Task 8 verifies the copy).

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/renderer.ts
git commit -m "desktop: getting-started card covers Google and Microsoft 365 connectors"
```

---

### Task 3: Dismissible artifact tab (app)

**Files:**
- Modify: `app/src/renderer/index.html:106`, `app/src/renderer/renderer.ts` (`displayArtifact` ~1003-1011, plus one new function + one wiring line), `app/src/renderer/styles.css` (append)

**Interfaces:**
- Consumes: existing `switchTab(tab)`, `state.tab` (set by `setActiveTab`), `state.hasArtifact`, `currentArtifact`.
- Produces: `closeArtifact(): void` (renderer-internal).

- [ ] **Step 1: Markup — give the tab a label span and a close control**

`app/src/renderer/index.html` line 106, change:

```html
        <button class="tab tab-artifact" data-tab="artifact" id="artifactTab" style="display:none">Artifact</button>
```
to:
```html
        <button class="tab tab-artifact" data-tab="artifact" id="artifactTab" style="display:none">Artifact<span class="tab-close" id="artifactClose" title="Close artifact">×</span></button>
```

- [ ] **Step 2: Renderer — stop clobbering the markup, add closeArtifact**

In `displayArtifact` (~line 1008), DELETE this line (it would wipe the close span; the label is constant anyway):

```ts
  $('artifactTab').textContent = 'Artifact';
```

Below `showArtifact` (~line 1012), add:

```ts
// Closing clears the pinned artifact and hides the tab. Panel back-history is
// deliberately left intact: ‹ can restore a closed artifact, doubling as undo.
function closeArtifact(): void {
  currentArtifact = null;
  state.hasArtifact = false;
  $('artifactTab').style.display = 'none';
  if (state.tab === 'artifact') switchTab('dashboard');
}
$('artifactClose').onclick = (e) => { e.stopPropagation(); closeArtifact(); };
```

(`stopPropagation` keeps the click from bubbling to the tab-strip delegate at renderer.ts:428, which would otherwise re-activate the artifact tab.)

- [ ] **Step 3: Styles**

Append to `app/src/renderer/styles.css`:

```css
/* close control inside the artifact tab */
.tab-artifact .tab-close { margin-left: 7px; opacity: .55; padding: 0 2px; font-size: 13px; }
.tab-artifact .tab-close:hover { opacity: 1; }
```

- [ ] **Step 4: Build + full app suite**

Run: `cd /Users/arjunraj/code/Memex/app && npm test 2>&1 | tail -8`
Expected: PASS (behavioral verification is in the Task 8 live drive: push artifact → × → Dashboard shown, tab hidden, ‹ restores).

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/renderer.ts app/src/renderer/styles.css
git commit -m "desktop: artifact tab is dismissible"
```

---

### Task 4: Artifact freshness + Claude Code hand-off (app)

**Files:**
- Modify: `app/src/main/agent.ts` (APPEND_PROMPT, new constructor param, new tool beside `show_artifact`), `app/src/main/main.ts` (launcher + wiring in `startSession` ~514), `app/src/renderer/renderer.ts:297-301` (tool label)

**Interfaces:**
- Produces: `AgentSession` constructor accepts optional `openInClaudeCode: (dirPath: string) => Promise<{ ok: boolean; message: string }>`; MCP tool name seen by permissions is `mcp__ui__open_in_claude_code` (must stay OUT of `canAutoAllowVaultTool`).

- [ ] **Step 1: APPEND_PROMPT additions**

In `app/src/main/agent.ts`, append two paragraphs to the end of the `APPEND_PROMPT` template literal (after the chips sentence):

```ts
ARTIFACT FRESHNESS: The artifact panel is a living surface, not an archive. When the conversation moves on and an earlier artifact no longer matches what the user is working on, replace it with something relevant — prefer refreshing an existing dashboard or report over minting a near-duplicate — or simply leave replies chat-only; the user can close a stale artifact with the × on its tab. Never keep steering the user back to an outdated artifact.

CLAUDE CODE HAND-OFF: Memex is a knowledge tool, not an IDE. When the user starts real software-engineering work on a code repository (multi-file changes, tests, a git repo outside this vault), offer to hand off: call the \`open_in_claude_code\` tool with the repo directory to launch a Claude Code session in their terminal, and keep the vault side (notes, tasks, decisions) here. Small vault-local scripts and one-off snippets are fine to do in place.
```

- [ ] **Step 2: Constructor param + tool registration**

In `AgentSession`, add a private field and constructor handling (mirroring `requestPermission`):

```ts
  private openInClaudeCode: (dirPath: string) => Promise<{ ok: boolean; message: string }>;
```

Constructor object gains `openInClaudeCode?: (dirPath: string) => Promise<{ ok: boolean; message: string }>;` and the body sets:

```ts
    // Fail closed if a host does not supply a launcher.
    this.openInClaudeCode = openInClaudeCode || (async () => ({ ok: false, message: 'Claude Code hand-off is not available in this host.' }));
```

In `start()`, after the `showArtifact` tool definition, add:

```ts
    const openInClaudeCode = tool(
      'open_in_claude_code',
      'Hand off to Claude Code: open the user\'s terminal running the `claude` CLI in a project directory. Use when the user wants to do real software-engineering work on a code repository.',
      {
        path: z.string().describe('Directory to open (absolute, or ~/... relative to the user home)'),
      },
      async (args) => {
        const res = await this.openInClaudeCode(args.path);
        return { content: [{ type: 'text' as const, text: res.message }], isError: res.ok ? undefined : true };
      }
    );
```

and register it: `createSdkMcpServer({ name: 'ui', version: '1.0.0', tools: [showArtifact, openInClaudeCode] })`.

- [ ] **Step 3: Launcher in main.ts**

In `app/src/main/main.ts`, near `startSession`, add:

```ts
// AppleScript string literal: escape backslashes and quotes.
function appleScriptString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Launch a terminal running `claude` in dirPath. The permission dialog (this
// tool is never auto-allowed) is the user's confirmation step.
async function launchClaudeCode(dirPath: string): Promise<{ ok: boolean; message: string }> {
  const full = path.resolve(expandHome(String(dirPath || '')));
  let stat: fs.Stats;
  try { stat = fs.statSync(full); } catch (_) {
    return { ok: false, message: `Directory not found: ${full}` };
  }
  if (!stat.isDirectory()) return { ok: false, message: `Not a directory: ${full}` };
  try {
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal"\n  do script "cd " & quoted form of ${appleScriptString(full)} & " && claude"\n  activate\nend tell`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', 'cmd', '/k', 'claude'], { cwd: full, detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('x-terminal-emulator', ['-e', 'claude'], { cwd: full, detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    return { ok: false, message: `Could not open a terminal: ${String((err as Error)?.message || err)}` };
  }
  return { ok: true, message: `Opened a Claude Code session in ${full}. Tell the user it is running in their terminal.` };
}
```

(`spawn` and `expandHome` are already imported/defined in main.ts — verify and reuse; do not re-import.)

Wire it in `startSession` (~line 514):

```ts
  nextSession = new AgentSession({
    cwd: vault,
    onEvent: (evt: AgentEvent) => { chain = chain.then(() => handleEvent(evt)).catch(() => {}); },
    requestPermission: (request) => requestAgentPermission(vault, nextSession, request),
    openInClaudeCode: launchClaudeCode,
  });
```

Do NOT touch `canAutoAllowVaultTool` — `mcp__ui__open_in_claude_code` must go through the dialog.

- [ ] **Step 4: Tool label in renderer**

In `toolLabel` (renderer.ts ~297), add before the generic `mcp__` branch:

```ts
  if (name.startsWith('mcp__ui__open_in_claude_code')) return 'Opening in Claude Code';
```

- [ ] **Step 5: Build + suite**

Run: `cd /Users/arjunraj/code/Memex/app && npm test 2>&1 | tail -8`
Expected: PASS (tsc clean; launcher behavior is exercised in the Task 8 live drive).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/agent.ts app/src/main/main.ts app/src/renderer/renderer.ts
git commit -m "desktop: artifact-freshness prompt + open_in_claude_code hand-off"
```

---

### Task 5: Provider-keyed init (engine tooling)

**Files:**
- Modify: `tools/memex_bake.py` (STREAM_MCP ~44, `sources_config_yaml` ~242, `_write_seed_files` ~434), `tools/memex_init.py` (`ask_git_mode` neighborhood ~155, `interview` ~210, `main` ~304, `print_post_init` ~214)
- Test: `tools/test_memex_init.py` (existing `sources_config_yaml` assertions ~147-166)

**Interfaces:**
- Produces: `normalize_provider(raw) -> str` ("google"|"microsoft", default "google"), `stream_mcp(provider) -> dict[str, str]` in memex_bake.py; `sources_config_yaml(..., provider="google")` kwarg; answers key `PROVIDER`; `print_post_init(streams, git_mode, provider)`.
- Consumed by: Task 6 copy edits, Task 7 skill prose (`streams.*.mcp`, `mailboxes.connected`).

- [ ] **Step 1: Write the failing tests**

In `tools/test_memex_init.py`, update the existing `sources_config_yaml` test to expect the new key, and add provider cases (import `normalize_provider, stream_mcp` alongside the existing memex_bake imports):

```python
    def test_sources_config_provider_google_default(self):
        out = sources_config_yaml(["email"], "local", "2026-07-24", connected_email="jane@example.com")
        self.assertIn('connected: "jane@example.com"', out)
        self.assertNotIn("gmail_connected", out)
        self.assertIn("provider: google", out)
        self.assertIn("mcp: claude_ai_Gmail", out)

    def test_sources_config_provider_microsoft(self):
        out = sources_config_yaml(
            ["email", "calendar"], "local", "2026-07-24",
            connected_email="jane@example.com", provider="microsoft",
        )
        self.assertIn("provider: microsoft", out)
        self.assertIn("mcp: claude_ai_Microsoft_365", out)
        self.assertNotIn("claude_ai_Gmail", out)
        self.assertNotIn("claude_ai_Google_Calendar", out)

    def test_provider_normalization(self):
        self.assertEqual(normalize_provider(None), "google")
        self.assertEqual(normalize_provider("MICROSOFT "), "microsoft")
        self.assertEqual(normalize_provider("outlook"), "google")   # unknown → default
        self.assertEqual(stream_mcp("microsoft")["email"], "claude_ai_Microsoft_365")
        # microsoft maps BOTH email and calendar to the one 365 connector
        self.assertEqual(stream_mcp("microsoft")["calendar"], "claude_ai_Microsoft_365")
        self.assertEqual(stream_mcp("google")["calendar"], "claude_ai_Google_Calendar")
```

Also fix the existing assertion at ~line 160: `'gmail_connected: "jane@example.com"'` → `'connected: "jane@example.com"'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/arjunraj/code/Memex/tools && python3 -m unittest test_memex_init -v 2>&1 | tail -5`
Expected: FAIL — `ImportError: cannot import name 'normalize_provider'`

- [ ] **Step 3: Implement in memex_bake.py**

Replace the flat `STREAM_MCP` (line 44) with:

```python
VALID_PROVIDERS = ["google", "microsoft"]
STREAM_MCP = {
    "google": {
        "email": "claude_ai_Gmail",
        "slack": "claude_ai_Slack",
        "calendar": "claude_ai_Google_Calendar",
    },
    # One connector serves both mail and calendar on the Microsoft side. This is
    # an init-time server-id string, not a tool name: skills discover tools from
    # `streams.*.mcp` at run time, so users can correct it in _config/sources.md.
    "microsoft": {
        "email": "claude_ai_Microsoft_365",
        "slack": "claude_ai_Slack",
        "calendar": "claude_ai_Microsoft_365",
    },
}


def normalize_provider(raw: Any) -> str:
    p = (raw or "google").strip().lower() if isinstance(raw, str) or raw is None else "google"
    return p if p in VALID_PROVIDERS else "google"


def stream_mcp(provider: Any) -> dict[str, str]:
    return STREAM_MCP[normalize_provider(provider)]
```

In `sources_config_yaml`, add the kwarg `provider: str = "google"`, resolve `provider = normalize_provider(provider)`, change `line()` to use `stream_mcp(provider)[name]`, add `provider: {provider}` to the frontmatter (after `scope: sources`), rename the mailboxes key `gmail_connected:` → `connected:`, and generalize the prose:
  - "Connected Gmail mailbox:" → "Connected mailbox:" and "the only mailbox the Gmail MCP searches." → "the only mailbox the mail connector searches."
  - "sent mail from these accounts is invisible to `in:sent`" → "sent mail from these accounts is invisible to the connector's sent-mail view"
  - Add one line under the frontmatter prose: `If your connector registers under a different server id, edit the `mcp:` values above — skills resolve tools from these ids at run time.`

In `_write_seed_files` (~line 434), pass the provider through:

```python
    seeds["_config/sources.md"] = sources_config_yaml(
        streams,
        git_mode,
        today,
        connected_email=answers.get("OWNER_PRIMARY_EMAIL", ""),
        forwarding_email=answers.get("OWNER_FORWARDING_EMAIL", ""),
        other_sending_accounts=answers.get("OWNER_SENDING_ACCOUNTS", ""),
        provider=normalize_provider(answers.get("PROVIDER")),
    )
```

- [ ] **Step 4: Implement in memex_init.py**

Import `normalize_provider, stream_mcp` from memex_bake (extend the existing import block at ~line 31 and `__all__` at ~48 if other names are listed there). Add after `ask_git_mode`:

```python
def ask_provider() -> str:
    """Which suite the mail/calendar Claude connectors come from."""
    print("\nMail & calendar provider for this vault:")
    print("  google    - Gmail + Google Calendar connectors (default)")
    print("  microsoft - Microsoft 365 connector (Outlook mail & calendar)")
    return normalize_provider(_prompt_input("  provider [google]: ").strip().lower())
```

In `interview()` (~line 210), after `answers["STREAMS"] = ask_streams()`:

```python
    answers["PROVIDER"] = ask_provider()
```

In `main()` (~line 304, next to the STREAMS/GIT_MODE normalization):

```python
    provider = normalize_provider(answers.get("PROVIDER"))
    answers["PROVIDER"] = provider
```

Change `print_post_init(streams, git_mode)` → `print_post_init(streams, git_mode, provider)` and its signature/body (~line 214) to `def print_post_init(streams: list[str], git_mode: str, provider: str = "google") -> None:` using `stream_mcp(provider)[stream]` in the connector loop. (The desktop app's answers.json has no PROVIDER key → defaults to google, preserving current behavior; no app change needed.)

- [ ] **Step 5: Run engine tests**

Run: `cd /Users/arjunraj/code/Memex/tools && python3 -m unittest test_memex_init test_memex_update -v 2>&1 | tail -5`
Expected: PASS. If test_memex_update asserts on `gmail_connected` or `STREAM_MCP`, update those assertions the same way.

- [ ] **Step 6: Legacy-key audit**

Run: `grep -rn "gmail_connected" /Users/arjunraj/code/Memex/tools /Users/arjunraj/code/Memex/packs /Users/arjunraj/code/Memex/hardened`
Expected: hits only in `packs/core` prose (handled in Task 7). Any `tools/` reader found must accept both `connected` and legacy `gmail_connected` — fix inline here if one exists.

- [ ] **Step 7: Commit**

```bash
git add tools/memex_bake.py tools/memex_init.py tools/test_memex_init.py tools/test_memex_update.py
git commit -m "engine: provider-keyed connector ids at init (google/microsoft)"
```

---

### Task 6: Git-mode copy reframes file-sync as first-class (engine tooling)

**Files:**
- Modify: `tools/memex_init.py` (`ask_git_mode` ~155, `print_post_init` none-branch ~225)

**Interfaces:** none (copy-only).

- [ ] **Step 1: Reframe the prompt**

In `ask_git_mode`, replace the `none` line:

```python
    print("  none   - no git; pick this if the vault lives in Dropbox / iCloud Drive /")
    print("           OneDrive (mixing git repos with sync folders invites corruption)")
```

- [ ] **Step 2: Reframe the post-init guidance**

In `print_post_init`, replace the `git_mode == "none"` branch body:

```python
    if git_mode == "none":
        print("\ngit mode: none - no git history. If this vault lives in Dropbox / iCloud /")
        print("OneDrive, the sync service's version history is your recovery path; otherwise")
        print("you lose the audit trail, time-travel, and recovery from a bad edit.")
        print("Run `git init` later to enable (not recommended inside a sync folder).")
```

- [ ] **Step 3: Verify + commit**

Run: `cd /Users/arjunraj/code/Memex/tools && python3 -m unittest test_memex_init -v 2>&1 | tail -3`
Expected: PASS

```bash
git add tools/memex_init.py
git commit -m "engine: frame file-sync vaults as a first-class git-mode choice"
```

---

### Task 7: Provider-neutral pack prose (packs/core)

Principle: **technique stays; syntax becomes provider-scoped; tool ids are discovered from `streams.*.mcp`.** The visibility model (connected mailbox vs forwarding-in vs other sending accounts) is provider-independent — keep it, reworded off "Gmail".

**Files:**
- Modify: `packs/core/skills/email/SKILL.md` (the deep one), `packs/core/skills/capture-comms/SKILL.md`, `packs/core/skills/daily-briefing/SKILL.md`, `packs/core/prompts/daily-briefing.md`, `packs/core/workflows/daily-briefing.md`, `packs/core/skills/reconcile-from-comms/SKILL.md`, `packs/core/skills/ingest-person/SKILL.md`, `packs/core/skills/ingest-project/SKILL.md`, `packs/core/skills/triage-inbox/SKILL.md`, `packs/core/skills/weekly-review/SKILL.md`, `packs/core/skills/observe-manual-patterns/SKILL.md`, `packs/core/skills/observe-task-actuals/SKILL.md`, `packs/core/skills/close-task/SKILL.md`, `packs/core/skills/create-task/SKILL.md`, `packs/core/schemas/task.md`

**Interfaces:**
- Consumes: `streams.email.mcp` / `streams.calendar.mcp` and `mailboxes.connected` (legacy `mailboxes.gmail_connected`) from Task 5's `sources.md` shape.

- [ ] **Step 1: email skill — provider-scoped restructure**

`packs/core/skills/email/SKILL.md`:

1. Frontmatter description first line: "…draft replies for the user's Gmail." → "…draft replies for the user's mail — Gmail or Microsoft 365, whichever connector `_config/sources.md` names."
2. Replace "## Step 0 — Load the Gmail tools" section with:

```markdown
## Step 0 — Resolve the mail connector and load its tools

`_config/sources.md` names the mail server under `streams.email.mcp` (e.g.
`claude_ai_Gmail` or `claude_ai_Microsoft_365`). Read it first, then load that
server's tools by id — never assume Gmail:

```
ToolSearch: +<server-id> search thread draft
```

Whatever the provider, you need three capabilities: thread/message **search**,
full-thread **read**, and **draft creation** (Gmail: `search_threads`,
`get_thread`, `create_draft`). If the configured server id matches no tools,
say so — the user may need to fix `streams.email.mcp` or connect the connector.
```

3. Insert a heading `### If the mail server is Gmail` immediately above the "Gmail query cheat-sheet" table (the table and its notes stay verbatim), and after that whole Gmail-scoped block add:

```markdown
### If the mail server is Microsoft 365 / Outlook

Gmail operators (`from:`, `in:anywhere`, `newer_than:`) do NOT apply. Use the
connector's own search parameters as its tool schemas describe them (sender /
recipient / date-range / keyword arguments, or KQL where the tool takes a query
string). The technique above is unchanged: search broadly in both directions
first, then narrow; read the full thread with the connector's thread/message
read tool before concluding anything; treat search snippets as possibly stale.
```

4. Sweep the remaining body: "the Gmail MCP" → "the mail connector" and `mcp__claude_ai_Gmail__get_thread` → "the connector's full-thread read tool (Gmail: `get_thread`)" everywhere OUTSIDE the Gmail-scoped section; "not in the connected Gmail mailbox" → "not in the connected mailbox". Keep memory names (`feedback_gmail_*`) as-is — they are proper nouns. The `{{OWNER_PRIMARY_EMAIL}}` visibility paragraph keeps its logic with "the Gmail MCP searches only" → "the mail connector searches only".

- [ ] **Step 2: capture-comms + daily-briefing family + reconcile-from-comms**

Same sweep in each file:
- `mailboxes.gmail_connected` → "`mailboxes.connected` (legacy vaults: `mailboxes.gmail_connected`)" — every occurrence.
- "the Gmail MCP" / "connected Gmail" → "the mail connector" / "connected mailbox"; "Scan Gmail" → "Scan mail".
- capture-comms Step-0-style ToolSearch lines (e.g. `ToolSearch: select:mcp__claude_ai_Gmail__search_threads,...`) become: "resolve the server id from `streams.email.mcp`, then `ToolSearch: +<server-id> search thread` (Gmail example: `select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread`)."
- Keep "Gmail and Slack are independently authenticated MCP servers…" rationale but say "the mail and Slack connectors".
- `get_thread(threadId)` references outside Gmail-scoped context → "the connector's thread read (Gmail: `get_thread(threadId)`)".

- [ ] **Step 3: The remaining wording sweeps**

- `packs/core/schemas/task.md` line 31: `calendar_event_id:        # Google Calendar event id, set by create-task when it makes the block` → `calendar_event_id:        # calendar event id (Google or Outlook), set by create-task when it makes the block`; line 75: "when `create-task` creates a Google Calendar block" → "when `create-task` creates a calendar block via the connected calendar connector".
- `create-task`, `close-task`, `ingest-person`, `ingest-project`, `triage-inbox`, `weekly-review`, `observe-manual-patterns`, `observe-task-actuals`: replace "Google Calendar" → "the calendar connector (`streams.calendar.mcp`)" and "Gmail" → "the mail connector" (ingest-person's "Gmail backfill is automatic there" → "mail backfill is automatic there"). Where a sentence names Gmail as an *example*, keep it parenthesized: "(e.g. Gmail's `search_threads`)".

- [ ] **Step 4: Verify the sweep**

Run:
```bash
grep -rn -i "gmail\|google calendar" /Users/arjunraj/code/Memex/packs/core | grep -v -i "if the mail server is gmail" | grep -v "feedback_gmail" | grep -v "(Gmail" | grep -v "Gmail example" | grep -v "legacy vaults"
```
Expected: only hits inside the email skill's Gmail-scoped section (between the `### If the mail server is Gmail` heading and the Microsoft heading) and `ask_provider`-style provider lists. Anything else is a miss — fix it.

Run: `cd /Users/arjunraj/code/Memex && python3 tools/audit_literals.py` (check `--help` first if it needs args; run however CI/docs invoke it)
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packs/core
git commit -m "packs: provider-neutral mail/calendar prose; tools resolved from streams.*.mcp"
```

---

### Task 8: Full verification + live drive

**Files:** none (verification only; fix-forward anything found).

- [ ] **Step 1: Full test sweep**

```bash
cd /Users/arjunraj/code/Memex/app && npm test
cd /Users/arjunraj/code/Memex/tools && python3 -m unittest discover -p 'test_*.py' -v
```
Expected: all PASS.

- [ ] **Step 2: Live drive (dev harness)**

Start: `cd /Users/arjunraj/code/Memex/app && MEMEX_DEV=1 MEMEX_OPEN=$HOME/code/memex-test-vault MEMEX_DEVCTL=/private/tmp/claude-502/-Users-arjunraj-code-Memex/cdd8565f-c9f2-400c-80d3-f0d7262d0d21/scratchpad/devctl.json npm start` (background). Use the devctl file (`{"js":..,"shot":..}`) to script and screenshot. Verify:

1. Getting-started card shows "Connect mail & calendar" with both Google and Microsoft 365 named (screenshot; fresh-vault state — clear the `memex-gs-skip:` localStorage key via devctl js if needed).
2. Push an artifact via devctl (`window.__dev.artifact({title:'t', kind:'markdown', html:'<b>hi</b>'})`), confirm the Artifact tab shows an ×; click it via js; confirm the tab hides and Dashboard renders; press ‹ (or `window.__dev` history) and confirm the artifact restores.
3. Ask the agent (devctl `window.__dev.send('Open ~/code/Memex in Claude Code')`) — expect a permission dialog for `mcp__ui__open_in_claude_code` (NOT auto-allowed). Deny it once to confirm deny works, then re-ask and Allow once: Terminal.app opens running `claude` in the repo. Close the spawned Terminal window afterwards.
4. Sync noise: `touch "$HOME/code/memex-test-vault/Ops/Tasks/x (conflicted copy 2026-07-24).md"` — confirm no new row appears in Tasks and ⌘K search doesn't surface it; remove the file after.

- [ ] **Step 3: Init smoke test (engine)**

```bash
cd /Users/arjunraj/code/Memex && rm -rf /tmp/memex-provider-smoke && printf '{"OWNER_NAME":"T","OWNER_PRIMARY_EMAIL":"t@example.com","TIMEZONE":"America/New_York","GIT_MODE":"none","STREAMS":"email,calendar","PROVIDER":"microsoft"}' > /private/tmp/claude-502/-Users-arjunraj-code-Memex/cdd8565f-c9f2-400c-80d3-f0d7262d0d21/scratchpad/answers.json && python3 tools/memex_init.py --eng . --target /tmp/memex-provider-smoke --packs core --answers /private/tmp/claude-502/-Users-arjunraj-code-Memex/cdd8565f-c9f2-400c-80d3-f0d7262d0d21/scratchpad/answers.json
grep -A8 "provider:" /tmp/memex-provider-smoke/_config/sources.md
```
Expected: `provider: microsoft`, `mailboxes.connected: "t@example.com"` (no `gmail_connected`), `streams.email.mcp: claude_ai_Microsoft_365`, and post-init connector text naming `claude_ai_Microsoft_365`. (If `validate_answers` requires more keys, satisfy them — the app's answers set at renderer.ts:99-102 is the reference.) Clean up `/tmp/memex-provider-smoke` after.

- [ ] **Step 4: Final commit (fixes only, if any)**

```bash
git add -A && git commit -m "desktop/engine: verification fixes for feedback round"
```
(Skip if the tree is clean.)
