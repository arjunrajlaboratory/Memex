# Design: default multi-source loop-closing + setup wizard

**Date:** 2026-06-04
**Status:** approved (implementing)
**Branch:** `feat/default-multi-source-loop-closing`

## Problem

The vault's biggest silent-failure mode is **state lagging reality**: the user
answers an email, posts a form in Slack, or finishes a meeting off-vault, and the
typed note rots at its old status. Two skills already address this — `capture-comms`
(scans Gmail sent+received and Slack sent+received, stages action items) and
`reconcile-from-comms` (closes the loops) — but they are **manual, separate** skills
that the user must remember to run. The daily briefing only has a weaker §0
"State confirmation needed" pre-flight that *guesses* at stale state.

The user wants the daily flow to, **by default**, check incoming + outgoing email,
Slack, and calendar (and be extensible to other sources), so that responding to an
email automatically reflects the completed work — and wants setup to (a) ask which
streams they use and tell them how to grant access, and (b) offer a privacy-aware
git mode.

## Decisions (locked with the user)

1. **Auto-close stance: A — keep the guardrail, with batching.** Reconcile
   auto-applies only reversible bookkeeping (bump `last_contact`, mark a Followup
   `acted_on`); task closes stay propose-only and are confirmed in one batch
   ("yes to 1,3,4"). The "agents never self-close to `done`" hard-no is preserved.
2. **Trigger model: inside `daily-briefing`.** Generating the briefing runs
   capture + reconcile as a Step 0, in the user's authenticated session (avoids the
   headless-auth gap that a cron job would hit). No new background infra.
3. **Calendar role: minimal.** Only a Task explicitly linked to a calendar event
   whose end-time has passed becomes a Tier-B "confirm close" item. No attendee
   matching, no `last_contact` bumping.
4. **Extensibility: three + config list + documented path.** Implement
   email/Slack/calendar now; store enabled streams as an editable config note, not
   hard-coded; document how to add a fourth source.
5. **Mailbox truth model: connected mailbox plus sending accounts.** Gmail `in:sent`
   is authoritative only for the mailbox the MCP is authenticated to. Forwarding can
   make received mail visible, but it does not make sent mail from that forwarding
   account visible. Non-connected sending accounts must be modeled explicitly and a
   sent-mail miss for them is inconclusive, not evidence of "not sent."

   > **Addendum (later finding — orthogonal axis).** `search_threads` is *not* fully
   > authoritative even for the connected mailbox: its index can be **stale** (observed
   > days behind reality, and unrefreshed by re-running the same search). Search is for
   > *locating* candidate threads only; `get_thread(threadId)` is the live ground truth
   > for a thread's latest state and whether a message exists. An empty search is
   > therefore "couldn't confirm," never "not sent" — for every user, regardless of how
   > many accounts they have. See memory `feedback_gmail_mcp_stale_reads`.

## Architecture

The briefing becomes the conductor; the existing skills stay the instruments.
Nothing is duplicated — `daily-briefing` *drives* `capture-comms` and
`reconcile-from-comms` inline (they are instruction-sets in the same session), so
their schema / log / sensitivity discipline is preserved and both remain usable
standalone.

```
/daily-briefing
   └─ Step 0a: read _config/sources.md          → which streams are enabled
   └─ Step 0b: run capture-comms (enabled only)  → Inbox/comms/<date>/ refreshed
   └─ Step 0c: run reconcile-from-comms          → Tier-A auto-applied (reversible);
   │                                                Tier-B collected, NOT applied
   └─ §0 "State confirmation needed" = reconcile Tier-B ∪ stale-state queries (deduped)
   └─ Steps 1–13: synthesis (tasks closed in 0c already reflect reality)
   └─ Report-back: single batched confirm → close-task for confirmed items
```

## Components

### A. Config seam — `_config/sources.md` (new, tracked)

Low-sensitivity note recording which streams the daily flow checks; read by
`capture-comms`, `reconcile-from-comms`, and `daily-briefing`. Editable by hand
post-init (no re-init needed to flip a stream).

```yaml
---
type: config
scope: sources
git_mode: local            # local | none | remote (recorded for reference)
updated: <YYYY-MM-DD>
mailboxes:
  gmail_connected: "{{OWNER_PRIMARY_EMAIL}}"
  forwarding_in: "{{OWNER_FORWARDING_EMAIL}}"
  other_sending_accounts: []       # normalized from OWNER_SENDING_ACCOUNTS comma-list
streams:
  email:    { enabled: true,  mcp: claude_ai_Gmail }
  slack:    { enabled: true,  mcp: claude_ai_Slack }
  calendar: { enabled: true,  mcp: claude_ai_Google_Calendar, mode: minimal }
---
```

Body documents the "add a new source" extension path (config entry + a
`capture-comms` scan block; reconcile needs no change since it reads the same
`## Action items` API).

The `mailboxes` block documents visibility, not authorization. `gmail_connected`
is the only mailbox `capture-comms` can search via Gmail. `forwarding_in` can make
received messages appear in that mailbox, but its own sent folder remains outside
scope. `other_sending_accounts` are outbound identities the user may use; if a
loop-closing reply might have gone from one of them, empty connected-Gmail search
results must be reported as "couldn't confirm" rather than "awaiting send."

**Backward compatibility:** if the file is absent (older vaults), skills assume
`email + slack enabled, calendar planning-only` — nothing breaks.

### B. Runtime — `daily-briefing` Step 0 orchestration

Insert between the existence check (Step 1) and gather (Step 2):

- Read `_config/sources.md`; no streams enabled / file absent → fall back to the
  existing §0 stale-state queries only.
- Run `capture-comms` for `<date>`, enabled streams only (it already handles a
  per-source MCP outage gracefully).
- Run `reconcile-from-comms` for `<date>` in **briefing sub-mode**: apply Tier-A
  automatically; **do not prompt mid-briefing** for Tier-B — hand the proposals up.
- §0 becomes **reconcile Tier-B ∪ the 4 stale-state queries** (deduped).
- For outbound-contact tasks, run the live comms pass before reporting status. Do
  not infer "not sent" from a work-log or stale task status when email is enabled;
  if the connected mailbox cannot see the relevant sending account, ask the user to
  confirm instead.
- Report-back presents §0 as the single batched confirm; confirmed closes route
  through `close-task`, then update reconcile's ledger/checkboxes.
- **Backfill for a far-past `<date>`:** skip the comms refresh (a comms scan only
  makes sense near today) and note it; generate from vault state.

`reconcile-from-comms` gets a short "When invoked by daily-briefing" note documenting
the defer-Tier-B-to-caller contract.

### C. Calendar (minimal loop-closing)

- `_schemas/task.md` gains optional `calendar_event_id:` and `calendar_event_title:`.
- `create-task` persists the created event's id into `calendar_event_id` (it already
  creates the event for time-blocked tasks).
- Gated on `calendar.enabled`: open tasks carrying a `calendar_event_id` whose event
  end-time has passed surface as a **Tier-B** "this meeting's time has passed — close
  the task?" item in the same reconcile batch. Canceled/declined events → a
  "reschedule or drop?" variant (the one stretch item).

### D. Setup — `memex_init.py` interview additions

After the existing placeholder questions:

1. **Stream selection** — per-stream y/n (email/slack/calendar), default
   `email,slack`. Non-interactive: optional `STREAMS` key in answers JSON
   (list or comma-string); default `["email","slack"]`. Writes `_config/sources.md`
   (added as a seed file; `_config/` added to `SCAFFOLD_DIRS`).
2. **Access-grant instructions** — printed at the end (init cannot configure
   claude.ai connectors, only instruct): connect each enabled stream's MCP connector;
   capture stays empty but never errors until connected.
3. **Git/privacy mode** — see E. Non-interactive: optional `GIT_MODE` key, default
   `local`.

`STREAMS` / `GIT_MODE` are **behavior answers**, read directly from the answers dict —
NOT added to `placeholders.json` (which stays the audited `{{TOKEN}}` catalog).

### E. Git/privacy modes

Init's git-init step becomes conditional on `git_mode`:

| Mode | Behavior | Warning printed |
|---|---|---|
| `local` (default) | `git init`, no remote (today's behavior) | — |
| `none` | skip `git init` | "No version history: lose audit trail, time-travel, recovery." |
| `remote` | `git init` + remote-setup guidance | Privacy warning ↓ |

**Remote warning:** raw comms digests under `Inbox/` are already gitignored and never
leave the machine — but reconciled facts (closed tasks, Person notes, Decisions) land
in tracked notes and *would* push. Guidance: use a **private** repo; note that
`sensitivity: sensitive` notes would sync. (Per-note gitignore-by-frontmatter is a
known limitation — future work, not built now.)

## What does NOT change (no regressions)

- "Agents never self-close to `done`" hard-no (guardrail A).
- Read-only on comms (never send/draft/react/schedule/mark-read).
- Sensitivity handling (`private` summarized up; `sensitive` never quoted).
- `Inbox/*` gitignored.

## Files touched

- `packs/core/skills/daily-briefing/SKILL.md` — Step 0 orchestration, §0 rewrite.
- `packs/core/skills/reconcile-from-comms/SKILL.md` — briefing sub-mode + calendar Tier-B source.
- `packs/core/skills/capture-comms/SKILL.md` — read `_config/sources.md`, gate streams.
- `packs/core/skills/create-task/SKILL.md` — persist `calendar_event_id`.
- `packs/core/schemas/task.md` — add `calendar_event_id` / `calendar_event_title`.
- `tools/memex_init.py` — stream selection, git mode, `_config/sources.md` seed, access-grant printout.
- `tools/test_memex_init.py`, `tests/test_init.sh`, `tests/fixtures/` — tests.
- `hardened/contract/CLAUDE.base.md`, `hardened/contract/AGENTS.base.md` — document the default flow, `_config/sources.md`, git modes; add `capture-comms` + `reconcile-from-comms` rows; fix the stale "Out of scope: Slack capture" line.

## Derive note

The engine is normally *derived* from a source vault (`tools/derive.py`). These edits
are made directly in the engine repo (the working copy the user PRs from); a future
`derive.py` run from a source vault would need the same changes applied there too.
The PR notes this.

## Testing

- `tools/test_memex_init.py` — unit tests for pure helpers (`parse_streams`,
  `sources_config_yaml`).
- `tests/test_init.sh` — assert `_config/sources.md` created with chosen streams; a
  `GIT_MODE=none` fixture init produces no `.git`; default init still produces `.git`.
- `python3 tools/audit_literals.py ./packs` and `./hardened` — must stay AUDIT CLEAN.
- `(cd tools && python3 -m unittest)`.
