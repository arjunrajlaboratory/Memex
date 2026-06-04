---
name: log-mutation
description: Append the canonical one-line entry to log.md for a vault mutation (create/update/archive/link/ingest/triage/brief/review/lint). Use whenever a vault mutation has just happened and needs the canonical one-line entry in `log.md` — signaled by direct invocation "/log-mutation", by phrases like "log this change", "append a log line for ...", "record this in the log", "make sure this is in log.md", or by another skill explicitly delegating the log-append step. The vault's append-only log is the audit trail that downstream skills (`session-start`, `weekly-review`, `daily-briefing`) rely on, and skipping it is the most common silent failure when work happens directly via Read/Edit/Write rather than through a parent skill that owns the log discipline. Use this any time you've just created, updated, archived, linked, ingested, triaged, briefed, reviewed, or linted a vault entity and you didn't already append the line. It's a tiny skill but it's the one that keeps every other skill honest — a missed log entry today is a Tracker that thinks nothing happened a week from now.
---

# Log one mutation to `log.md`

You are running in whatever actor role made the change — `me`, `agent:capture`, `agent:librarian`, `agent:planner`, `agent:executor:<role>`, `agent:tracker`, or `agent:auditor`. Your job: append one canonical line to `log.md` describing one mutation, in the exact format the file's header defines.

## Why this skill exists

The vault contract (in `CLAUDE.md` and `AGENTS.md`) says: "After any vault-content mutation, append one line to `log.md`." It's been the most-skipped step in practice — the act of editing a file via `Edit` or `Write` doesn't carry a "and now also log it" reflex the way a wrapper skill does.

`session-start` reads the log tail to summarize "what happened recently"; `weekly-review` reads the last 7 days of log to find drift; the auditor checks for "create → log" pairs. Every missed line corrupts those reads — a Decision was made and the project page changed, but the log doesn't show it, so the weekly review undercounts work and the auditor can't tell if the project page is current.

This skill is the cheap reflex that closes the gap. It's small on purpose: one read of the file's format, one append, done.

## Inputs

You need five fields:

| Field | What it is | How to choose |
| --- | --- | --- |
| `datetime` | ISO 8601 with timezone | `<now>` in `{{TIMEZONE}}` (e.g., `2026-05-18T15:42:00-04:00`). Don't approximate to a date; the time matters for ordering. |
| `actor` | Who did the thing | `me` for user-driven action; `agent:<role>` if a skill is acting. See list below. |
| `verb` | The kind of mutation | One of `create`, `update`, `archive`, `link`, `unlink`, `ingest`, `triage`, `brief`, `review`, `lint`. Use the closest verb; don't invent. |
| `target` | The note(s) affected | Wikilinks: `[[X]]`, or compound when multiple notes were touched: `[[Y]] + [[Z]]`. |
| `summary` | One sentence | What changed and why. Past tense. Include the "delta" — `status: next → done`, `created`, `superseded`, etc. — not just "edited." |

### Actor vocabulary (from AGENTS.md)

- `me` — user-driven actions, including ones where the user instructed the agent step-by-step.
- `agent:capture` — `triage-inbox`, `create-task` invoked from triage.
- `agent:librarian` — `promote-idea`, `capture-decision`, `ingest-source`, `ingest-person`, `ingest-project`.
- `agent:planner` — `session-start`, `daily-briefing`, the weekly review's structuring pass.
- `agent:executor:<role>` — when an agent did the substantive work of a task (`agent:executor:writing`, `agent:executor:coding`, etc.).
- `agent:tracker` — `run-trackers`.
- `agent:auditor` — `lint`, the auditor pass at the end of `weekly-review`.

If a parent skill is in flight, defer to its actor — don't override mid-flow. If unsure, `me` is the safe default for user-confirmed mutations.

## Step 0 — Read the log

Read the top ~10 lines of `log.md` for two reasons:

1. Confirm the format hasn't drifted from what this skill encodes.
2. Avoid duplicating a line you (or a parent skill) already wrote in this same turn. The pattern is one line per *logical mutation* — if you created a Task and a calendar event in one move, that's one line, not two.

## Step 1 — Format the line

The exact format (from `log.md`'s own header):

```
<datetime> — <actor> — <verb> — <target> — <one-line summary>
```

Em-dashes (`—`, U+2014), not hyphens. Spaces around each em-dash. No leading bullet, no trailing punctuation. Wikilinks in the `target` field, not bare titles.

Length: keep the summary to one sentence. If you have more to say, that's a Work-log entry on the Task or a Changelog entry on the Project — not the log. The log is the index, not the content.

### Good lines

```
2026-05-18T15:42:00-04:00 — me — create — [[Test API integration in ExampleProject]] — scheduled 2026-05-19T12:00–12:30 ET under [[ExampleProject Platform]]; calendar event created; unblocks [[Author weekly post on most recent shipped ExampleProject feature]].

2026-05-18T16:10:00-04:00 — agent:librarian — create — [[Switch post flow to autonomous Sunday-night draft]] — supersedes [[Mon 12:00 ET manual post draft block]]; shapes [[ExampleProject - Growth and Marketing]].

2026-05-18T16:55:00-04:00 — agent:tracker — brief — [[ExampleProject releases]] — material=true items=3; [[Tracker Digest - exampleproject-releases - 2026-05-18]] created; auto-updated [[ExampleProject - Growth and Marketing]] # Open loops.
```

### Bad lines (and what's wrong)

```
2026-05-18 — me — did stuff — [[X]] — updated some fields
```

— Date with no time (breaks ordering), made-up verb, vague summary.

```
2026-05-18T15:42:00-04:00 - me - create - [[X]] - new task
```

— Hyphens instead of em-dashes, summary doesn't carry the delta.

## Step 2 — Append (newest on top)

`log.md` is newest-on-top: the divider line `---` separates the header from the entries, and new entries go *immediately after* the divider, pushing older ones down. Use `Edit` with the `---\n\n` divider + the most recent existing entry as the anchor, and insert the new line + a blank line above it.

If two skills are racing to log in the same turn, do them as separate `Edit` calls with distinct anchors — don't batch into one block.

## Step 3 — Report back

```
Logged: <datetime> — <actor> — <verb> — <target> — <summary>
```

If you're invoked from inside another skill, the parent skill's wrap-up usually already includes the log line; in that case, don't re-print it — the parent owns the user-facing summary.

## What this skill does NOT do

- **Does not do the mutation.** It only appends the line. The thing it's logging happened before this skill was invoked. If a user says "log that I closed [[X]]" but the Task isn't actually closed, fix the Task first (via `close-task`), then log.
- **Does not log diagnostics.** `session-start` reads the vault and synthesizes; that's not a mutation. Don't log reads.
- **Does not batch.** One mutation = one line. Two mutations = two lines (or, occasionally, one compound line if and only if they are inseparable — Task + matching calendar event qualifies; two Tasks created at once do not).
- **Does not retroactively log.** If a mutation happened yesterday and was skipped, write today's line with a "(catchup; mutation happened YYYY-MM-DD)" note in the summary rather than backdating the timestamp.

## Model recommendation

Any model — this is a formatting task. Inherited model is fine.

## Related

- `log.md` — the file itself. Its header defines the format; this skill defers to whatever's currently in that header.
- Every other skill — most of them call this one (or inline its single append) at the end of their flow.
- `CLAUDE.md` § "When you write a note" — the contract that requires this discipline.
- `weekly-review` — reads the log to find patterns; an honest log is its prerequisite.
