# Schema: implementation

An **Implementation** is a how-it-works writeup: a runnable spec, a code architecture, a system diagram, or a procedure. It is meant to outlive any single project.

File path: `Atlas/Implementations/<Name>.md`

## Frontmatter

```yaml
---
type: implementation
id: impl-<slug>
status: draft             # draft | current | deprecated
project: "[[<Name>]]"
related_decisions: []
related_sources: []
last_validated: YYYY-MM-DD
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Purpose`
- `# Architecture`
- `# Components`
- `# Data flow`
- `# Failure modes`
- `# Operating procedures`
- `# Open questions`
