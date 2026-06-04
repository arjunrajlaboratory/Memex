# Schema: journal

A **Journal** entry is a reflective, first-person note — the type a capture-triage classifies as `journal` per [[_workflows/capture-triage]] ("First-person reflective"). One file per day. Multiple entries on the same day go in the same file under separate `## HH:MM — <topic>` headings.

File path: `Inbox/_journal/YYYY-MM-DD.md`

> **Folder rationale (open question):** journals currently live under `Inbox/_journal/` because the capture-triage workflow files them there. They are *not* inbox items awaiting further triage — they are durable. A future schema revision may relocate journal entries to a dedicated top-level folder (e.g. `Atlas/Journal/` or `Ops/Journal/`); for now the inbox-adjacent path is canonical and the underscore prefix marks the folder as a system slot rather than a capture queue.

## Frontmatter

```yaml
---
type: journal
id: journal-YYYYMMDD              # one id per day; subsequent entries on the same day reuse it
date: YYYY-MM-DD                  # the date the entries refer to (may differ from `created` if backfilled)
author: me                        # me | "[[<Name>]]" — defaults to me; named only if you're capturing someone else's words verbatim with consent
tags: []                          # free-form topical tags, e.g. [rhythm, energy, mood, projects, relationships]
related_people: []                # wiki links to People mentioned, if any
related_projects: []              # wiki links to Projects mentioned, if any
related_concepts: []                # wiki links to Topics mentioned, if any
sensitivity: private              # default; do not lower without explicit user instruction
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

Journal entries are intentionally loose. The only required structure is one second-level heading per entry on a multi-entry day, with the time and a short topic slug:

- `## HH:MM — <topic slug>` — one section per discrete entry
- Below each heading: free-form prose. A blockquote of the original capture text (if triaged from `Inbox/`) is a useful convention.

Recommended (not required) optional subsections within an entry:

- A blockquote of the original capture, verbatim
- "Pattern" — what this is a possible instance of (e.g. "Tuesday-context-switch")
- "Possible follow-ups" — proposed (not created) tasks, efforts, or wiki edits

## Rules

- Default `sensitivity: private`. Journal entries are first-person reflective; do not quote them in `05_Outputs/` files or external comms without explicit user instruction.
- Author defaults to `me`. If a journal entry is being captured *from* someone else (e.g. a transcribed conversation reflection), set `author` to the relevant `[[<Name>]]` link and confirm the person consents to having the entry in the vault.
- Journals are append-only within a day. Do not edit a prior day's journal entries without leaving an audit note (a `## EDIT YYYY-MM-DD HH:MM — <reason>` subsection).
- The auditor lints for journal entries with no `date:` or with `date:` outside the file's date-named filename (e.g. `2026-01-15.md` containing `date: 2026-01-16` is a flag).
- Do not invent the `date:` field. If a triaged reflective capture references "today" but the capture itself is undated, leave `date:` set to the triage-day and add a body note about the ambiguity.

## When to use a different type instead

- The entry names a concrete commitment ("I should call Alex Friday") → `task`, not journal.
- The entry records an event with another person ("Met Sam, discussed X") → `interaction`, not journal. A journal can summarize the *feeling* about the interaction; the interaction note carries the facts.
- The entry expresses a fuzzy multi-week idea ("I want to explore X") → `effort`, not journal. A journal can be the place where the idea first surfaces; promote to an effort note once it's clearly a thread.
- The entry is a decision ("I've decided to drop Y") → `decision`, not journal.
