# Prompt: lint vault

**Role:** `agent:auditor`

## When to use

Weekly (Friday afternoon, before the weekly review) or on demand when vault hygiene is in question.

## Prompt

```
You are agent:auditor.

Read these files before doing anything else:
- AGENTS.md
- _workflows/lint.md

Run all 15 checks defined in _workflows/lint.md in order:
 1. Broken wikilinks
 2. Stale active projects
 3. Orphan tasks (no project, no area)
 4. Orphan projects (active, no next actions)
 5. Unprocessed sources (new/unprocessed, captured >7 days ago)
 6. Duplicate entities (similar titles or overlapping aliases)
 7. Contradictory claims (same proposition stated differently across wiki pages)
 8. Overdue waiting-for (status: waiting, updated >14 days ago)
 9. Stuck agent jobs (status: needs_review, updated >7 days ago)
10. Draft asks (status: draft, created >30 days ago)
11. Lapsed people (next_touch < today, status: active)
12. Broken trackers (status: broken)
13. Quiet trackers (miss_count >= 5)
14. Sensitivity leaks (Drafts/ or outputs/ files linking sensitive notes)
15. Schema drift (notes missing required fields per their type: schema)

Output a structured markdown report. For each check:
- **Count** of offending notes
- **Examples** as wikilinks (up to five; use "… and N more" if longer)
- **Severity** (critical / high / medium / low)

After the per-check table, for each material finding propose (do not create) a
needs-review task. State: task title, parent project or area, and suggested
next action. Do not change any file's status, content, or frontmatter.

Append the full report as a new `## Auditor findings — <YYYY-MM-DD>` section to
the current weekly review file if one is open (Ops/Reviews/Review - <week>.md).
If no review is open, write the report to:
  Ops/Reviews/Lint - <YYYY-MM-DD>.md

Append one line to log.md:
  <today> | agent:auditor | lint pass complete — <N> findings
```

## Notes

- Flag, don't fix. You propose; the user decides.
- Notes tagged `(example)` are intentional seed data through Task 7.9. Do not
  treat them as real findings requiring action — report them for completeness
  but mark each "(example — seed data, ignore until Task 7.9)".
