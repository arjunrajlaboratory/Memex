# Schema: area

An **Area** is an ongoing domain of life or work that does not have a finish line: Research, Personal Operating System, Writing, Health, Family, Finances. Areas contain projects, recurring responsibilities, principles, and dashboards.

File path: `Atlas/Areas/<Display Name>.md`

## Frontmatter

```yaml
---
type: area
id: area-<slug>
status: active            # active | dormant | archived
owner: me
review_cadence: weekly    # daily | weekly | biweekly | monthly | quarterly
importance: 5             # 1–5
next_review: YYYY-MM-DD
related_areas: []
related_ideas: []         # wikilinks to "[[...]]" notes scoped to this area
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Purpose` — one paragraph
- `# Principles` — bullet list of standing rules for this area
- `# Active projects` — wiki-linked
- `# Recurring responsibilities` — bullet list
- `# Standing dashboards` — links to Bases views
- `# Notes`

## Rules

- Areas never have a `done` status. If an area stops being relevant, set `status: archived`.
- Every active project must link to exactly one area via its `area:` field.
