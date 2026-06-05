# Schema: effort

An **Effort** is a looser thread than a project: a research direction, an idea cluster, or a theme that may eventually become a project. Use efforts for "some related, some loosely related" threads that are not yet outcome-shaped.

File path: `Atlas/Efforts/<Display Name>.md` — run the name through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: effort
id: eff-<slug>
status: incubating        # incubating | active | converged | archived
area: "[[<Name>]]"
maturity: fuzzy           # fuzzy | shaping | sharp
related_projects: []
related_concepts: []
related_sources: []
promote_to_project_when: "<concrete trigger>"
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What this is` — paragraph
- `# Why it might matter`
- `# Open questions`
- `# Evidence so far` — links to sources
- `# Adjacent threads` — links to related efforts/projects/topics
- `# Promotion criteria` — what would make this a real project

## Rules

- Efforts without any update for 90 days should be flagged by the auditor for archive or promote.
- When promoting an effort to a project, create the project page, copy or link relevant context, and set the effort to `status: converged` with a `superseded_by` link.
