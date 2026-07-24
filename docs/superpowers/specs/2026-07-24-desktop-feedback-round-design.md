# Desktop feedback round: provider neutrality, artifact lifecycle, Claude Code hand-off, sync-model openness

Date: 2026-07-24. Branch: `memex-desktop-app`. Driven by tester feedback: (1) agent
"assumes a Google universe" for a Microsoft 365 user; (2) the artifact panel goes stale —
an early artifact stays pinned after the user moves on; (3) living in Memex tempts users
to start Claude Coding from there; (4) (added during review) the engine is git-oriented,
but some users will want Dropbox-style file sync instead.

## 1. Provider-neutral mail/calendar (engine packs + init tooling)

The abstraction already half-exists: `_config/sources.md` records an MCP server id per
stream (`streams.email.mcp: claude_ai_Gmail`), but skills ignore it and hardcode
`mcp__claude_ai_Gmail__*` tool ids and Gmail-only prose.

### `tools/memex_bake.py` / `tools/memex_init.py`

- Init asks a provider question: `google` (default) or `microsoft`. The answer selects
  the per-stream MCP server ids written to `sources.md` (`STREAM_MCP` becomes
  provider-keyed: email → `claude_ai_Gmail` or the Microsoft 365/Outlook connector id;
  calendar → `claude_ai_Google_Calendar` or its Outlook equivalent). The Microsoft ids
  are init-time strings, not tool names — skills discover actual tools at run time, so an
  id mismatch is user-correctable in `sources.md` without an engine change.
- `mailboxes.gmail_connected` is generalized to `mailboxes.connected`. Readers (skills,
  bake) accept the legacy key so existing vaults keep working; new bakes write only the
  new key.
- `sources.md` prose drops Gmail-specific wording ("the connected mail connector").
- Non-interactive/desktop init paths (the app passes `GIT_MODE`/`STREAMS` answers)
  default provider to `google` when unanswered, preserving current behavior.

### `packs/core` skills and prompts

Principle: **technique is provider-agnostic; syntax is provider-scoped; tool ids are
discovered, not assumed.**

- `skills/email/SKILL.md` — the deep one. Resolve the mail server id from
  `streams.email.mcp`; load tools via ToolSearch against that server id. Core technique
  (search broadly both directions → `get_thread`-style full read is ground truth → never
  send, drafts only → stale-index caution) stays, phrased against "the connected mail
  connector." The Gmail query cheat-sheet moves under an explicit "If the mail server is
  Gmail" section; a parallel "If the mail server is Microsoft 365 / Outlook" section says
  to use that connector's native search parameters (no Gmail operators) and to discover
  its thread/read tools rather than assuming names.
- `skills/capture-comms/SKILL.md`, `skills/daily-briefing/SKILL.md`,
  `prompts/daily-briefing.md`, `workflows/daily-briefing.md`,
  `skills/reconcile-from-comms/SKILL.md` — replace "Gmail MCP"/"connected Gmail" with the
  connector resolved from `sources.md`; keep the visibility model (connected mailbox vs
  forwarding-in vs other sending accounts) verbatim, it is provider-independent.
- `skills/ingest-person/SKILL.md`, `skills/ingest-project/SKILL.md`,
  `skills/triage-inbox/SKILL.md`, `skills/weekly-review/SKILL.md`,
  `skills/observe-manual-patterns/SKILL.md`, `skills/observe-task-actuals/SKILL.md`,
  `skills/close-task/SKILL.md`, `skills/create-task/SKILL.md` — wording sweeps of the
  same kind; calendar references become "the connected calendar connector."
- `schemas/task.md` — `calendar_event_id` comment: "calendar event id (Google or
  Outlook), set by create-task when it makes the block."
- Audit gate: run `tools/audit_literals.py` after the sweep; no remaining bare
  "Gmail"/"Google Calendar" outside the provider-scoped sections.

## 2. App: getting-started card (renderer)

`src/renderer/renderer.ts` getting-started card "⚲ Connect Gmail & Calendar" becomes
"⚲ Connect mail & calendar." Copy names both ecosystems at claude.ai → Settings →
Connectors: Google (Gmail, Google Calendar, Drive) **or** Microsoft 365 (Outlook mail,
Outlook calendar, OneDrive). No layout change.

## 3. Artifact lifecycle (renderer + agent prompt)

- **Dismiss:** the Artifact tab gets a small × (rendered inside the tab button). Clicking
  it clears `currentArtifact`, sets `state.hasArtifact = false`, hides the tab, and
  switches to Dashboard if the artifact was active. Panel back-history is left intact —
  ‹ can restore a closed artifact, doubling as undo. A new artifact push re-shows the tab
  exactly as today.
- **Agent freshness (`APPEND_PROMPT` in `src/main/agent.ts`):** the artifact panel is a
  living surface. When the conversation moves to a new topic, replace or refresh the
  artifact rather than leaving an early one pinned; prefer updating an existing
  dashboard/report over minting near-duplicates; chat-only is fine when nothing visual is
  relevant; the user can close a stale artifact with the × on the tab.

## 4. Claude Code hand-off

- **New in-process MCP tool `open_in_claude_code`** (registered beside `show_artifact` in
  `src/main/agent.ts`, handled in `src/main/main.ts`): input `{ path }` — absolute or
  `~`-relative directory. Main process expands and validates the directory exists, then
  launches a terminal running `claude` there (macOS: Terminal.app via `osascript`;
  Windows: `cmd /c start`; Linux: `x-terminal-emulator` best-effort). NOT in the
  auto-allow set — the normal permission dialog is the confirmation step. The tool result
  tells the agent the session was launched so it can say so in chat.
- **`APPEND_PROMPT` addition:** Memex is a knowledge tool, not an IDE. When the user
  starts real software-engineering work on a code repository, offer to hand off and use
  `open_in_claude_code` on the repo path. Small vault-local scripting stays in-app.

## 5. Sync-model openness (git vs Dropbox-style file sync)

`git_mode: none` already exists but is framed purely as loss. Reframe file-sync as a
legitimate choice and tolerate its artifacts:

- **`memex_init.py` copy:** the `none` option reads "none — no git; pick this if the
  vault will live in Dropbox / iCloud Drive / OneDrive (mixing git repos with sync
  folders invites corruption)." Post-init guidance for `none` mentions the trade
  (sync-service version history instead of git history) alongside the existing warning.
- **App tolerance for sync artifacts:** vault scans (`src/main/vault.ts`), search
  (`src/main/search.ts`), and the wiki index skip sync-conflict files — names containing
  ` (conflicted copy` (Dropbox), ` (Case Conflict` (Dropbox), `.icloud` placeholders —
  so a syncing vault doesn't show duplicate phantom rows. One shared predicate in
  `src/main/watch-policy.ts` (where ignore policy already lives).
- **Docs:** `sources.md` template's git_mode line and README/vault docs mention file-sync
  as the reason to choose `none`. No new sync machinery; git remains the recommended
  default.

## Testing

- Engine: `tools/test_memex_init.py`, `tools/test_memex_update.py` extended for the
  provider question, provider-keyed `STREAM_MCP`, `mailboxes.connected` (+ legacy-key
  read), and the reframed git-mode copy. `audit_literals.py` sweep passes.
- App: `tsc` build clean; existing `app/test` suite; new unit coverage for the
  sync-artifact predicate. Live drive via dev harness (`MEMEX_DEV=1`,
  `MEMEX_OPEN=~/code/memex-test-vault`, `MEMEX_DEVCTL`): push an artifact, close it via
  ×, verify Dashboard fallback and ‹ restore; verify getting-started copy; invoke
  `open_in_claude_code` and observe the permission dialog + Terminal launch.

## Out of scope

Full proactive "ambient workspace" auto-generation (noted as possible follow-up), Claude
Tag/Slack integration, hardcoding Microsoft 365 tool names, any new sync engine.
