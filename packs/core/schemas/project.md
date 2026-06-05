# Schema: project

A **Project** has a desired outcome and can finish. It is the central unit of work in the vault.

File path: `Atlas/Projects/<Display Name>.md` — run the name through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = title/name = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: project
id: prj-<slug>
status: active            # active | paused | waiting | archived | done | dropped
area: "[[<Name>]]"
phase: design             # idea | design | building | shipping | maintaining
importance: 5             # 1–5
urgency: 4                # 1–5
energy: medium            # low | medium | high
started: YYYY-MM-DD
target_date: YYYY-MM-DD
next_review: YYYY-MM-DD
related_projects: []
related_efforts: []
related_ideas: []         # wikilinks to "[[...]]" notes that spawned or feed this project
people:
  stakeholders: []
  collaborators: []
  reviewers: []
  decision_makers: []
sources: []
open_task_query: "type = task and project = prj-<slug> and status != done"
agentifiable: true        # true if any subtask can be delegated to an LLM agent
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections (required)

- `# Outcome` — one paragraph; what "done" looks like
- `# Current status` — 2–4 sentences; updated weekly
- `# Why this matters` — motivation, stakes, deadline rationale
- `# Open loops` — bulleted; things in flight
- `# Current next actions` — wiki-linked tasks
- `# Key decisions` — wiki-linked decision notes
- `# Risks / blockers`
- `# Source notes` — wiki-linked sources
- `# Implementation notes` — wiki-linked implementation pages
- `# Changelog` — bulleted, dated; updated by the librarian agent when state changes

## Rules

- A project page is the single pane of glass for its effort. The librarian agent must update `# Current status`, `# Open loops`, and `# Changelog` whenever a referenced task, decision, or source changes.
- Do not duplicate task content on the project page. Link to tasks.
- If `status: waiting`, the project page must say what it's waiting on (and link to the relevant person/task).
