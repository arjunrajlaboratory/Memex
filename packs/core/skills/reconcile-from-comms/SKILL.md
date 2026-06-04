---
name: reconcile-from-comms
description: Reconcile the vault against a day's captured communications — read the staged Inbox/comms/<date>/ action items, match each to its real vault note, and either auto-apply the trivial reversible bookkeeping (bump Person last_contact/next_touch, mark a Followup acted_on) or surface the consequential ones (close a Task, flip a Letter to submitted, capture a Decision) for explicit confirmation before applying. Use whenever the user wants their off-vault work folded back into vault state — signaled by phrases like "reconcile my comms", "close the loops from today's comms", "what state changes do my comms imply", "apply the comms digest", "what should I update from today", "did my emails/slack close anything", or direct invocation "/reconcile-from-comms". This is PHASE 2 — it consumes the Inbox/comms/<date>/ files produced by capture-comms (phase 1). It NEVER sends email or Slack (read-only on comms), never auto-closes a Task to done (that stays the user's call), and never lowers sensitivity. Consequential or sensitive changes are always proposed, never auto-applied.
---

# reconcile-from-comms

The **loop-closing half** of the [[Daily comms digest and automated loop-closing]] idea. Phase 1
([[capture-comms]]) observed the day's comms and staged what they imply. This skill reads that
staging material and **reconciles vault state with reality** — the vault's biggest silent-failure
mode (a note rotting at its old status after the user did the work off-vault).

You run as **`agent:librarian`** for the bookkeeping you apply directly, and you **delegate every
consequential typed-note change to its owning skill** ([[close-task]], [[create-task]],
[[capture-decision]], [[ingest-person]], [[ingest-source]]) so their schema / log / parent-page
discipline is preserved. You are an upgrade of the daily-briefing §0 "State confirmation needed"
pre-flight — it relied on the user remembering; this reads the captured signal.

## Hard rules (non-negotiable)

- **The `## Action items` sections are the primary input.** Parse the phase-1 checkbox + `↳` blocks
  from `Inbox/comms/<date>/*.md`. The prose sections (`## Summary`, `## Threads worth routing`,
  `## Filtered as noise`) are context, not instructions. (One addition: the optional
  **calendar loop-closing** pass below contributes Tier-B proposals from vault Tasks whose linked
  calendar event has passed, when the `calendar` stream is enabled in `_config/sources.md`.)
- **Two tiers, and the line between them is firm** (see table). Auto-apply ONLY reversible CRM
  bookkeeping. Everything consequential, irreversible, sensitive, or needing a narrative is
  **proposed and held for explicit confirmation** — apply nothing in that tier until the user says
  yes, per item.
- **Never auto-close a Task to `done`.** Closing is the user's call (CLAUDE.md hard-no). When the
  user confirms a close, route it through [[close-task]] (which enforces the Work-log + unblocks
  bookkeeping) — do not hand-edit `status: done`.
- **Read-only on comms.** Never send / draft / react-to / schedule email or Slack. You may re-read
  a thread (via the phase-1-loaded MCP tools) to confirm a match, but you never write to Gmail/Slack.
- **Honor sensitivity.** Anything the phase-1 file flagged `[sensitive — summarized]` (e.g. a career
  decision) is **always** propose-only and never auto-applied; do not expand the summary or quote it.
  Never lower a note's sensitivity.
- **Delegate, don't reinvent.** Use the owning skill for each consequential mutation. The only
  changes you apply directly are the Tier-A bookkeeping fields (no skill wraps those).
- **Idempotent.** Maintain a reconciliation ledger (see below) so a second run on the same day's
  files never re-applies. If every action item is already reconciled, say so and stop.

## The two tiers

| Tier | Change | How | Why this tier |
| --- | --- | --- | --- |
| **A — auto-apply** | Bump Person `last_contact` to the comm date; recompute `next_touch` from `contact_cadence` | Direct `Edit` + log line | Reversible, non-destructive, not a completion claim |
| **A — auto-apply** | Followup `status: pending/surfaced → acted_on` when its tickled action clearly happened | Direct `Edit` + log line | Reversible bookkeeping |
| **B — confirm first** | Close a Task (→ `done` / `canceled`) | Confirm → [[close-task]] | Irreversible-ish; needs Work-log narrative; agents never self-close |
| **B — confirm first** | Letter `drafting → submitted` (+ set `submitted:` date) | Confirm → `Edit` the Letter note | Asserts an external state; consequential |
| **B — confirm first** | Capture a Decision the comms imply | Confirm → [[capture-decision]] | Needs rationale/alternatives; often sensitive |
| **B — confirm first** | Create a new Task / Followup / Person / Source from a routing suggestion | Confirm → [[create-task]] / [[ingest-person]] / [[ingest-source]] | New entities are commitments |
| **B — confirm first** | Close a Task whose linked calendar event has passed | Confirm → [[close-task]] | External state; agents never self-close (calendar pass below) |
| **B — always** | Anything `[sensitive]` or any p0/p1 Task | Confirm only — never auto | Sensitivity + stakes |

When a Tier-A change is uncertain (confidence `low`, or no clean note match), demote it to Tier B
and propose it instead of applying.

## Idempotency ledger

Phase 1 deliberately leaves its action-item checkboxes unmarked — marking them is **this skill's**
job, and the mark is the idempotency key. For each reconciled item:

1. In the phase-1 source file, flip its `- [ ]` to `- [x]` and append ` ↳ reconciled: <disposition> · <date>`
   (disposition = `applied` / `confirmed+applied` / `proposed` / `skipped` / `superseded`).
2. Append (or extend) a `## Reconciliation — <datetime>` section at the **bottom** of each source
   file — below phase-1's generated sections, which phase-1 promises to preserve on regeneration
   (its Step 6). This ledger is the source of truth: on a re-run, skip any item already marked
   `applied` / `confirmed+applied` / `skipped` there, even if a checkbox got reset.

```markdown
## Reconciliation — 2025-01-15T21:10:00-05:00
- ✅ applied — bumped [[Robin Park]] last_contact → 2025-01-15
- ⏸ proposed (awaiting confirm) — close [[Follow up with Alex Kim on project timeline review]]
- ⤴ skipped — [sensitive] career decision → routed to capture-decision (user-led)
```

## Steps

1. **Resolve the date + load the files.** Date = today (or the date arg). `ls Inbox/comms/<date>/`.
   If the folder is missing, tell the user to run [[capture-comms]] first and stop. Read every
   `*.md` there; parse each `## Action items` block (checkbox + the `↳ signal / likely target /
   suggested action / confidence` fields). Read any existing `## Reconciliation` ledger.

2. **Merge cross-file duplicates.** The same loop can appear in both `email.md` and `slack.md`
   (e.g. a PR review requested by email + "ran codex" in Slack). Collapse to one reconciliation
   item, keeping both signals as provenance. Drop items already marked done in the ledger.

3. **Resolve each `likely target` to a real note.** Confirm the wikilink resolves
   (`ls Atlas/... Ops/Tasks/...` or grep). If it says `(no obvious target)`, this is a *create*
   proposal (Tier B), not an update. If the link is wrong, search by person-name + subject keyword
   (the way `observe-task-actuals` triangulates) before giving up. Re-read the comm thread via the
   MCP tools only if you need to confirm the action truly happened.

4. **Classify into Tier A or Tier B** per the table. Demote on low confidence / sensitivity / no match.

5. **Apply Tier A, then show it.** Apply the reversible bookkeeping (Edit the Person/Followup
   field), append a `log.md` line per change, and update the ledger + checkbox. Then list what you
   applied — the user sees it the same turn and can ask you to revert (it's reversible by design).

6. **Propose Tier B as a numbered list; apply only what's confirmed.** Present each as:
   `<n>. <change> on [[target]] — because <signal>. Via <skill>.` Get explicit per-item confirmation
   (a batch "yes to 1,3,4" is fine). For each confirmed item, invoke the owning skill (do not
   hand-edit, except the Letter `submitted` flip which is a clean two-field Edit). For declined
   items, mark the ledger `skipped`. Never apply an unconfirmed Tier-B item.

7. **Update ledger + checkboxes** for every item touched (Step ledger format above).

8. **Log.** One `log.md` line summarizing the run (the per-change Tier-A lines from Step 5 are
   separate and already appended):
   ```
   <datetime> — actor:me — reconcile — Inbox/comms/<date>/ — reconcile-from-comms: <A> auto-applied, <C> confirmed+applied, <P> still-proposed, <S> skipped
   ```

9. **Report back.** What was auto-applied, what's awaiting confirmation, what was routed to which
   skill, and what was skipped (with the sensitive/uncertain reason). Offer the obvious follow-ons
   (e.g. "want me to run [[capture-decision]] on the leadership meeting now?") but don't act unprompted.

## Calendar loop-closing (gated on the `calendar` stream)

A minimal, opt-in pass that runs **only** when `_config/sources.md` has
`streams.calendar.enabled: true` (default off). It catches the common lag where a
meeting happened but its prep/follow-up Task is still open.

1. Find open Tasks (`status` not in `[done, canceled]`) carrying a `calendar_event_id:`.
2. Determine whether the linked event's end-time has passed. Prefer a live lookup via
   the Calendar MCP (`mcp__claude_ai_Google_Calendar__get_event`) so you also see if
   the event was **canceled/declined**; if the MCP is unavailable, fall back to the
   Task's `scheduled_end` / `calendar_event_title` and the current time.
3. For an event that **occurred** and is past: propose a **Tier-B** close —
   `Close [[<Task>]] — its calendar event "<title>" ended <when>. Done?` Confirm → [[close-task]].
4. For an event that was **canceled/declined**: propose **Tier-B** instead as
   "reschedule or drop?" — never auto-close (the work may still be owed). Surface it; let
   the user decide.

No attendee matching and no `last_contact` bumping — that's deliberately out of scope
(the "minimal" choice). These proposals merge into the same Tier-B batch as the comms
items and obey the same confirm-then-`close-task` rule.

## When invoked by daily-briefing

`daily-briefing` runs this skill as Step 0c of generating the morning briefing. In that
context:

- **Apply Tier-A exactly as normal** (reversible bookkeeping — bump `last_contact`, mark
  a Followup `acted_on`) and update the ledger.
- **Do NOT run the interactive Step 6 prompt.** Instead, hand the Tier-B proposals (comms
  closes + the calendar pass above) back to the briefing. The briefing renders them in its
  **§0 "State confirmation needed"** and owns the single batched confirmation in its
  report-back. When the user later confirms ("yes to 1,3,4"), route each through
  [[close-task]] / the owning skill and update this skill's ledger + checkboxes then.

Run standalone (direct `/reconcile-from-comms`), Step 6 stays interactive as written.

## What this skill never does

- Send / draft / react-to / schedule any email or Slack message.
- Auto-close a Task to `done`, or apply any Tier-B change without explicit confirmation.
- Auto-apply anything flagged `[sensitive]`, or expand/quote a summarized-up sensitive item.
- Lower a note's sensitivity.
- Hand-edit a typed note where an owning skill exists (route through it instead).
- Re-apply an item already in the reconciliation ledger.

## Model recommendation

`opus` (inherited) — the target-matching, cross-file merge, and tier judgment need real thought.

## Related

- [[capture-comms]] — phase 1; produces the `Inbox/comms/<date>/` files this consumes.
- [[close-task]] / [[create-task]] / [[capture-decision]] / [[ingest-person]] / [[ingest-source]] — the owning skills it delegates consequential changes to.
- [[daily-briefing]] — runs this skill as Step 1b by default; its §0 "State confirmation needed" is this skill's Tier-B output (see "When invoked by daily-briefing" above).
- `_config/sources.md` — gates the calendar loop-closing pass (`streams.calendar.enabled`).
- `Daily comms digest and automated loop-closing` (idea) — the full two-phase design + the "major item" threshold rationale.
