---
name: weekly-review
description: Run the Friday step-back over the last 7 days of vault activity — patterns, drift, debt — synthesizing log + briefings + projects + tasks + trackers + commitments + asks into a Review note (recommendations only; never changes state). Use when the user wants a Friday-shaped step-back over the last seven days of vault activity — signaled by phrases like "let's do the weekly review", "weekly retro", "Friday review", "step back on the week", "what happened this week", "where did the week go", "run the weekly", or direct invocation "/weekly-review" / "/weekly-review 2026-W20". Reads the last 7 days of log.md, every daily briefing in the period, every active/paused/waiting Project, every Task closed in the period plus every still-open Task that was also open 7 days ago, every Tracker (active + broken), every Commitment due in the next 14 days, every Ask in draft/ready older than 7 days. Synthesizes (does NOT redo the daily briefing — looks for *patterns, drift, debt*) into Ops/Reviews/Review - <ISO-week>.md per _schemas/review.md, with the canonical body sections (What happened / Got done / Slipped + why / Lessons / Projects to advance / Projects to pause / Relationships to attend to / Trackers / Decisions to revisit / Auditor findings). Auditor findings section runs the full lint checklist from _workflows/lint.md. Every recommendation is a *suggestion*, not an action — never changes Project or Task status on its own. Use end-of-week or any time the user wants the pattern view on the last seven days.
---

# Weekly review

You are running as **`agent:planner`** for the synthesis and **`agent:auditor`** for the Auditor findings section.

The user wants a structured step-back over the last seven days. Daily briefings answer "what's the operating state today" — the weekly review answers "what patterns, drift, and debt accumulated this week, and where should next week pay attention?"

## Why this skill exists

Without an explicit weekly step-back, the vault drifts:

- Stale Projects that should be paused stay `status: active`.
- Slipped Tasks pile up without anyone naming "why."
- Trackers that no longer fire useful signal keep running.
- Commitments to people drift past their soft deadlines without a re-touch.

The weekly review surfaces these patterns in one pass. The user reads it Friday afternoon (or Monday morning) and decides what to act on. The skill **proposes** changes; it never makes them.

## Inputs

- `{{week}}` — optional ISO week string, e.g. `2026-W20`. Default: ISO week of today.

If invoked mid-week, the skill still uses the **last 7 calendar days** (a rolling window) rather than waiting for Friday.

## Step 0 — Orient

Read these in full:

- `_schemas/review.md` (so you know the output shape)
- `_workflows/weekly-review.md` (the full long-form workflow)
- `_workflows/lint.md` (for the Auditor findings checklist)
- AGENTS.md (the contract — don't modify state silently)

Compute the date window: `[today - 6 days, today]` inclusive.

## Step 1 — Gather inputs (in parallel)

Dispatch these reads in a single message so they run concurrently:

1. **Log tail** — last 7 days of `log.md`. Read whatever fits.
2. **Daily briefings in the period** — `ls Ops/Briefings/` and Read each one in `[today-6, today]`.
3. **Active / paused / waiting Projects** — grep `Atlas/Projects/` for `status: active`, `paused`, `waiting`. Sample the `# Current status` body section of each.
4. **Tasks closed in the period** — grep `Ops/Tasks/` for `status: done` AND `updated:` in window.
5. **Tasks open >7 days** — grep `Ops/Tasks/` for `status: next` OR `in_progress`, then filter to those with `updated:` ≥ 7 days ago.
6. **All Trackers** — grep `Atlas/Trackers/` for status `active` or `broken`. Note any with `next_check:` in the past.
7. **Commitments due in next 14 days** — grep `Atlas/People/Commitments/` for `due:` in `[today, today + 14]`.
8. **Asks ≥ 7 days in draft/ready** — grep `Atlas/People/Asks/` for `status: draft` or `ready` with `created:` ≥ 7 days ago.

While these run, prep your output file path: `Ops/Reviews/Review - <ISO-week>.md`.

## Step 2 — Synthesize, don't re-summarize

The weekly review is **not** a daily briefing summed over 7 days. It looks for:

- **Patterns** — three tasks all about the same surface, suggesting a missing Project. A pattern of slipped deadlines in one Area.
- **Drift** — a Project that hasn't moved in 14 days but is still `status: active`. A Tracker that's reported `no material changes` four runs in a row.
- **Debt** — Asks that have been "ready" for a week and never sent. Commitments approaching their due date with no movement. Decisions deferred twice.

Be willing to say things like "this Project hasn't moved; consider pausing" or "this Tracker should be retired" or "you owe X a reply on Y." That's the value.

## Step 3 — Write the review

Create `Ops/Reviews/Review - <ISO-week>.md` with the frontmatter from `_schemas/review.md` and body sections in this order:

```markdown
## What happened
- 4-8 bullets of the most significant moves of the week — not exhaustive

## What got done
- Tasks closed, decisions made, ships, key meetings — wikilinks

## What slipped — and why
- Tasks, commitments, asks that didn't move. *Always* name why (waiting on X, blocked by Y, deprioritized, energy low).

## Lessons
- 2-4 bullets. What this week tells you that should change next week's behavior.

## Projects to advance next week
- Specific Projects with a "next move" — wikilinks + one-line action

## Projects to pause
- Recommendations only. Each with a one-line "why pause."

## Relationships to attend to
- Specific People with a soft-due commitment, an unsent ask, or just "I haven't pinged them in a while."

## Trackers worth re-pointing or re-cadencing
- Trackers reporting no signal — retire? Trackers reporting too much — narrow?

## Decisions to revisit
- Decisions whose underlying assumption may have shifted this week.
- The dedicated **revisit-decisions** observer (invoked in Step 3.5) handles Decisions whose `revisit_on:` has fallen due — that's a different population than this section. *This* section is for Decisions whose assumptions seem to be moving even though the revisit date hasn't fired.

## Pruning candidates
- The weekly review is the vault's pruning ritual — without it, the task layer grows monotonically. Surface (as *suggestions*, never act unilaterally):
  - **Stale scheduled tasks**: `status: scheduled`, `scheduled_end` >3 days in the past, no recent `# Work log` activity → propose `canceled` (didn't happen, not worth rescheduling) or `next` (slipped, still relevant).
  - **Old done tasks**: `status: done` AND `updated` >30 days ago → propose archive to `_archive/Ops/Tasks/`.
  - **Drift tasks**: `status: next` AND `updated` >30 days AND no `# Work log` entries in the period → propose `canceled` or someday/.
  - **Empty primitives**: `Atlas/Efforts/`, `Atlas/Relationships/`, `Atlas/People/Asks/`, `Atlas/People/Commitments/`, `05_Outputs/` if still empty after 60+ days — keep dormant, introduce deliberately, or delete the folder.
  - **Lapsed Followups**: `status: pending` AND `surface_on` >14 days past → propose `dismissed` or fresh surface.
  - **Stuck `needs_review` tasks**: `status: needs_review` >14 days → propose resolving in the review session itself.

## Auditor findings
- Run the full lint checklist from _workflows/lint.md (all checks). List offending notes as wikilinks. One bullet per material finding — condense, don't dump.

## Learnings
- The four observer skills append their own sub-sections here (see Step 3.5). Leave this section empty in your draft; the observers will fill it in.
```

Sensitivity: `private`. The review references private People notes; default to `sensitivity: private` on the review itself.

## Step 3.5 — Dispatch the four observers (in parallel)

After the main synthesis body (Step 3) is written but before the final report-back, dispatch the four observer skills. They each scan a different signal source and append a sub-section under `## Learnings`. The four are independent — run them in parallel by issuing all four Skill invocations in a single message.

The four observers:

1. **`revisit-decisions`** — surfaces Decisions whose `revisit_on:` has fallen due and `outcome: pending`. Prompts the user for outcome + one-line note, then writes the outcome back into the Decision note.
2. **`observe-skill-corrections`** — scans Claude Code transcripts in `~/.claude/projects/{{CC_PROJECT_SLUG}}/` for corrective turns following Skill invocations. Surfaces skills with the highest correction count this week.
3. **`observe-manual-patterns`** — scans `log.md` for `actor:me` mutations not wrapped in known skills, flags repeated shapes as skill candidates.
4. **`observe-task-actuals`** — for Tasks closed in the period, triangulates actual time from Gmail / Drive / git / calendar signals, writes `actual_effort:` + `actual_effort_source:` on the Tasks, and surfaces a small number for sparse self-report.

Each observer is self-contained — it knows to append its findings under the open weekly review's `## Learnings` section (or create a standalone observation file if no open review exists). It also logs its own line to `log.md`. The weekly-review skill does not duplicate this work; it only dispatches.

If an observer fails (transcripts dir missing, MCP unavailable, etc.), capture the failure as a single bullet under `## Learnings` — `<observer-name>: skipped — <reason>` — and continue. Don't fail the whole review on one observer's bad day.

## Step 4 — Recommendations are proposals only

This is the **hardest rule** of this skill:

- **Do not** change any Project's `status:`.
- **Do not** close or change any Task.
- **Do not** retire any Tracker.
- **Do not** mark a Person as out-of-cadence.

You **propose**; the user **decides**. The "Projects to pause" section is a list of recommendations, not an action.

The only state change the skill makes is writing the Review file itself and appending one line to `log.md`.

## Step 5 — Log

Append to `log.md`:

```
<datetime> — agent:planner — review — [[Review - <ISO-week>]] — weekly review covering <date>..<date>; <N> recommendations across <areas>
```

## Step 6 — Open in browser via Quartz (default)

The artifact is at `Ops/Reviews/Review - <week>.md`. The user reads it in the browser, not the terminal. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Ops/Reviews/Review - <week>"
```

Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 7 — Report back

Tight summary for the user:

```
[[Review - <ISO-week>]] is ready.

Headline patterns:
- <one bullet on the most significant pattern/drift/debt finding>
- <second bullet if there is a second significant finding>

Top recommendations (decision needed from you):
1. <first recommendation, with the wikilink>
2. <second>
3. <third>

Auditor findings: <N> issues flagged, mostly <category>.
Learnings (observers): <one line per observer with a notable finding, or "no signal" if a clean week>.
```

## What this skill does NOT do

- **Does not re-do daily briefings.** If the user wants today's briefing, they should run `daily-briefing` instead.
- **Does not lint exhaustively.** The Auditor findings section is condensed — one bullet per material issue. For a full lint pass, the user can invoke the lint prompt separately.
- **Does not change state.** Every recommendation is a suggestion.
- **Does not lower sensitivity** on referenced notes.

## Model recommendation

`opus`. Synthesis across many entities is exactly the judgment-heavy work Opus is for. Don't downgrade to Sonnet — the value of this skill is in the pattern recognition, and Sonnet will miss subtle drift signals.

## Related

- `Agents/Prompts/weekly-review.md` — paste-able prompt equivalent.
- `_workflows/weekly-review.md` — long-form workflow.
- `_schemas/review.md` — the schema for the output file.
- `daily-briefing` (paste prompt at `Agents/Prompts/daily-briefing.md`) — the daily sibling that this skill explicitly does NOT duplicate.
- `lint` (paste prompt at `Agents/Prompts/lint.md`) — the dedicated auditor pass; this skill runs a condensed version inside the Auditor findings section.
- `revisit-decisions`, `observe-skill-corrections`, `observe-manual-patterns`, `observe-task-actuals` — the four learning-loop observers dispatched in Step 3.5; each appends its findings under `## Learnings`.
