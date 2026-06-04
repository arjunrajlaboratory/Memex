# Schema: review

A **Review** is a periodic step-back: weekly, monthly, quarterly. It looks across projects, captures lessons, and resets priorities.

File path: `Ops/Reviews/Review - YYYY-Www.md` (weekly) or `YYYY-MM.md` (monthly).

## Frontmatter

```yaml
---
type: review
id: rev-<scope>-YYYYWNN
scope: weekly             # weekly | monthly | quarterly | annual | adhoc
period_start: YYYY-MM-DD
period_end: YYYY-MM-DD
generated_by: agent:planner
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What happened`
- `# What got done`
- `# What slipped` — and why
- `# Lessons`
- `# Projects to advance next period`
- `# Projects to pause`
- `# Relationships to attend to`
- `# Trackers worth re-pointing` — see [[_schemas/tracker]]
- `# Decisions to revisit`
