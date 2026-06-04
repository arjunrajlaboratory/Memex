# Schema: commitment

A **Commitment** is a promise between you and a person. Tasks are things to do; commitments are the *social/relational* contract. A commitment usually spawns a task, but the two carry different meaning.

File path: `Atlas/People/Commitments/<slug>.md`

## Frontmatter

```yaml
---
type: commitment
id: com-YYYYMMDD-<slug>
status: open              # open | fulfilled | renegotiated | broken | dropped
from: me                  # me | "[[<Name>]]"
to: "[[<Name>]]" # or me
project: "[[<Name>]]"
related_task: "[[<Title>]]"
made_on: YYYY-MM-DD
due: YYYY-MM-DD
fulfilled_on:
source_interaction: "[[<Name> - YYYY-MM-DD]]"
importance: 4             # 1–5
relationship_impact: medium  # low | medium | high
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What was promised` — verbatim if possible
- `# Why it matters`
- `# Status notes` — running notes on whether/how/when
- `# Resolution` — what actually happened (fill on close)

## Rules

- Every open commitment with `from: me` must appear on the `I owe` view.
- Every open commitment with `to: me` (i.e. `from: <person>`) appears on the `Waiting on` view.
- Renegotiation creates a new commitment with `supersedes:` link; do not silently mutate the original.
