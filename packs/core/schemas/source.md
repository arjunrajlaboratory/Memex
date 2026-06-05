# Schema: source

A **Source** is a processed representation of a raw input (article, paper, transcript, screenshot, dataset). The raw file lives in `Raw/`; the source note in `Atlas/Sources/` summarizes it, extracts claims, and lists which wiki pages were updated as a result.

File path: `Atlas/Sources/<Display Title>.md` — the filename is this note's canonical name (no separate `title:` field). Run it through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"; article titles carry `:`/`/` constantly): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: source
id: src-<slug>
source_kind: article      # article | paper | book | transcript | video | podcast | screenshot | dataset | email | meeting_notes | conversation | template
raw_path: "Raw/sources/<filename>"
url:
status: new               # new | unprocessed | processing | processed | needs_review
author: ""
publisher: ""
published: YYYY-MM-DD
captured: YYYY-MM-DD
processed:
reliability: high         # high | medium | low | unknown
related_concepts: []
related_projects: []
related_decisions: []
people_mentioned: []
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Summary` — 3–6 sentences
- `# Key claims` — bullet list; each claim is a single proposition
- `# Useful patterns` — reusable techniques or frames
- `# Contradictions / caveats`
- `# Pages updated` — wiki links to the wiki pages this source modified
- `# Tasks created` — wiki links
- `# Direct quotes` — only if needed; cite location

## Rules

- The librarian agent must, on ingest, update `# Pages updated` with every wiki page it modified as a consequence of this source.
- Never edit the file under `raw_path`. Treat it as evidence.
- If `reliability: low` or `unknown`, the librarian must mark any wiki claims derived from this source with `needs_review: true`.
