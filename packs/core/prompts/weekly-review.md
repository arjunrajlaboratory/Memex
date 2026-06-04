# Prompt: weekly review

**Claude Code users:** invoke `/weekly-review` instead — same logic, auto-triggered as a skill from natural-language phrasings (`.claude/skills/weekly-review/SKILL.md`).

**Role:** `agent:planner` (inputs, synthesis, output) / `agent:auditor` (lint findings section)

## Parameters

- `{{week}}` — ISO week string, e.g. `2026-W20` (default: ISO week of today)

## When to use

Friday afternoon, or any time you want a structured step-back over the past seven days.

## Prompt

```
You are agent:planner (and agent:auditor for the Auditor findings section).

Read these files before doing anything else:
- AGENTS.md
- _workflows/weekly-review.md
- _schemas/review.md
- _workflows/lint.md  (auditor findings section only)

Inputs to gather:
1. Last 7 days of log.md
2. All daily briefings in the period (Ops/Briefings/)
3. All projects with status: active, paused, or waiting
4. All tasks closed in the period; all tasks still next/in_progress that were also so 7 days ago
5. All trackers (active and broken)
6. All commitments due in the next 14 days
7. All asks in draft or ready older than 7 days

Do NOT redo the daily-briefing job. Step back — look for patterns, drift, and debt across the week.

Produce Ops/Reviews/Review - {{week}}.md using the frontmatter and body sections defined
in _schemas/review.md. The body must contain these sections in order:

## What happened
## What got done
## What slipped — and why
## Lessons
## Projects to advance next week
## Projects to pause
## Relationships to attend to
## Trackers worth re-pointing or re-cadencing
## Decisions to revisit
## Auditor findings

For "Auditor findings": run the full lint checklist from _workflows/lint.md (all 15 checks).
List offending notes as wikilinks. Condense — one bullet per material finding.

For "Projects to pause" and any other recommendations: write them as recommendations only.
You propose; the user decides. Do not change any project or task status.

When the review file is saved, append one line to log.md:
  <today> | agent:planner | created Review - {{week}}.md
```

## Notes

- Every recommendation in the review is a suggestion, not an action — the user decides what to act on.
- The auditor findings section should be condensed from the lint pass, not exhaustive noise.
- Do not lower sensitivity on any note. The review itself is `sensitivity: private`.
