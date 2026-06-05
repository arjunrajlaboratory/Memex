# Schema: concept

A **Concept** is a knowledge page: an idea, technique, technology, or domain. Concepts aggregate the sources, projects, and people that touch them. Use concepts liberally — they are the cross-cutting backbone of the graph. (A Concept is a *subject you understand*; contrast with an Area, which is a *responsibility you maintain*.)

File path: `Atlas/Concepts/<Name>.md` — run the name through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: concept
id: concept-<slug>
status: active            # active | dormant | archived
maturity: shaping         # nascent | shaping | sharp | mature
related_concepts: []
related_projects: []
related_sources: []
people_who_know: []
canonical_sources: []
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What this is`
- `# Why it matters to me`
- `# Current understanding`
- `# Open questions`
- `# Key sources`
- `# Adjacent concepts`
- `# People who know this`
- `# Projects that touch this`

## Rules

- The librarian updates `# Current understanding` when new sources land that change the picture.
- A concept with `maturity: nascent` and no source updates in 180 days should be flagged by the auditor.
