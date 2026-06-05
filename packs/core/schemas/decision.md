# Schema: decision

A **Decision** is a deliberate choice that you want to be able to defend, revisit, or supersede later. Decisions explain *why* the vault (or a project) is the way it is.

File path: `Atlas/Decisions/<Display Title>.md` — the filename is this note's canonical name (no separate `title:` field). Run it through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`. (Distinct from the kebab-case `id: dec-<slug>`.)

## Frontmatter

```yaml
---
type: decision
id: dec-<slug>
status: accepted          # proposed | accepted | superseded | rejected
date: YYYY-MM-DD
project: "[[<Name>]]"   # or area
area: "[[<Name>]]"
decision: "<one-sentence statement>"
revisit_on: YYYY-MM-DD
outcome: pending          # pending | worked | partial | failed | superseded
outcome_notes: ""         # one-line summary, set when outcome != pending
supersedes: []
superseded_by: []
related_sources: []
people_involved: []
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Decision` — restate in one paragraph
- `# Rationale` — why this, not the alternatives
- `# Alternatives considered` — bulleted; each with a one-line "why not"
- `# Evidence` — links to sources
- `# Consequences` — what this commits us to / forecloses
- `# Revisit trigger` — what would make us reopen this
- `# Outcome` — appended when `outcome:` is set to anything other than `pending`. One short paragraph: what actually happened, dated. Append-only; if outcome shifts later, add a new dated entry rather than rewriting.

## Rules

- A decision page is append-only in spirit: do not silently rewrite history. To reverse a decision, create a new decision with `supersedes: [old]` and mark the old one `status: superseded` with `superseded_by:` populated.
- The librarian must link this decision from every project page whose direction it shapes.
- `outcome:` defaults to `pending` on creation. It is set by the user (or by the `revisit-decisions` skill prompting the user) when `revisit_on` falls due. The skill never sets `outcome:` itself — it only surfaces decisions that are due. When `outcome != pending`, the `# Outcome` body section must be populated.
