# Schema: followup

A **Followup** is a scheduled prompt to act later — a tickler. Lighter than a task; it just resurfaces something at a chosen time.

File path: `Ops/Followups/<slug> - YYYY-MM-DD.md`

## Frontmatter

```yaml
---
type: followup
id: fup-YYYYMMDD-<slug>
status: pending           # pending | surfaced | acted_on | dismissed
surface_on: YYYY-MM-DD
about: "[[<Name>]]"   # or task, project, source, decision
reason: ""
suggested_action: ""
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Why I want to remember this`
- `# What I should do when this surfaces`
- `# Context`

## Rules

- The planner agent surfaces all `pending` followups with `surface_on <= today` in the daily briefing.
- After surfacing, set `status: surfaced` and add to today's briefing.
