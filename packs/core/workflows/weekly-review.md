# Workflow: weekly review

**Role:** `agent:planner` (or `agent:auditor` for the lint half)
**Trigger:** Friday afternoon, or explicit user request
**Output:** `Ops/Reviews/Review - <YYYY-Www>.md`

## Inputs

- Last 7 days of `log.md`
- All daily briefings in the period
- All projects with `status in [active, paused, waiting]`
- All tasks closed in the period
- All tasks still `next` or `in_progress` that were also so 7 days ago
- All trackers (active and broken)
- All commitments due in the next 14 days
- All asks in `draft` or `ready` older than 7 days

## Body skeleton

```markdown
# Weekly review — {{week}}

## What happened
## What got done
## What slipped — and why
## Lessons
## Projects to advance next week
## Projects to pause
## Relationships to attend to
## Trackers worth re-pointing or re-cadencing
## Decisions to revisit
## Pruning candidates
## Auditor findings
```

## Pruning ritual (in the `## Pruning candidates` section)

The weekly review is also the vault's **pruning ritual** — without it, the task layer grows monotonically and Operating-loop signal degrades. For each of the categories below, list candidates as suggestions (never act unilaterally — the user closes/cancels/archives).

- **Stale scheduled tasks.** Tasks with `status: scheduled` and `scheduled_end` more than 3 days in the past with no `# Work log` activity since — propose `canceled` (with a one-line "didn't happen, rescheduling not warranted" rationale) OR `next` (if it's still relevant, just slipped its block).
- **Old done tasks.** Tasks with `status: done` AND `updated` more than 30 days ago. Propose moving to `_archive/Ops/Tasks/` (preserving the original path under `_archive/`). Keeps `Ops/Tasks/` listing scannable; the closed work is still searchable.
- **Drift tasks.** Tasks with `status: next` AND `updated` older than 30 days AND no `# Work log` entry in the period. These are the silent backlog — the user almost certainly isn't going to do them. Propose `canceled` or move to a `someday/` area.
- **Empty primitives.** Folders that exist but are empty after 60+ days of vault life: `Atlas/Efforts/`, `Atlas/Relationships/`, `Atlas/People/Asks/`, `Atlas/People/Commitments/`, `05_Outputs/`. Each weekly review decides: keep dormant (a flag for the audit), introduce deliberately (write the first one this week), or delete the folder.
- **Lapsed Followups.** Followups with `surface_on` more than 14 days in the past AND `status: pending` — these were surfaced but never acted on. Propose `dismissed` or surface again with a fresh reason.
- **Stuck `needs_review` tasks.** Tasks at `status: needs_review` for more than 14 days. Propose the user resolve them in the review session itself.

## Rules

- Do not redo the daily-briefing job. The weekly review takes a *step back* — look for patterns, drift, debt.
- The auditor findings section runs the lint workflow and condenses it.
- If you propose pausing a project, do it as a recommendation, not an action. The user decides.
