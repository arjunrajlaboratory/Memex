# Schema: idea

An **Idea** is a pre-commitment seed: something worth thinking about but not yet a Task (no acceptance criteria) and not yet a Project (no outcome promised). Ideas can stay loose for a long time, get fleshed out by research, then be promoted to a Task / Effort / Project — or dropped.

File path: `Atlas/Ideas/<Display Name>.md` — run the name through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = `title:` = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: idea
id: idea-<slug>
title: "<one-line summary>"
status: raw               # raw | exploring | researching | promoted | dropped | archived
project: ""               # optional "[[<Name>]]" — the parent project this idea belongs to
area: ""                  # optional "[[<Name>]]" — the broader area
related_concepts: []
related_ideas: []
priority: unranked        # p0 | p1 | p2 | p3 | unranked
effort_estimate: unknown  # low | medium | high | unknown
tags: []                  # free-form tags: mcp, backend, ai-tooling, etc.
people: []                # collaborators who'd be relevant; wikilinks
sources: []               # sources that informed the idea; wikilinks
promoted_to: []           # set when status: promoted — wikilinks to the Task/Project/Effort
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections (required minimum: the first two)

- `# What's the idea` — 1–3 sentences. The core, in plain language.
- `# Why this could be worth doing` — motivation, stakes, who benefits.
- `# Open questions` — what we'd need to figure out before committing.
- `# Research notes` — filled by `/flesh-out-idea` skill (or manually). What's known, prior art, vault connections.
- `# Proposed first step` — concrete, time-bounded; filled by `/flesh-out-idea` or manually.
- `# Promoted to` — only present when `status: promoted`; wikilinks to the Tasks/Projects/Efforts spawned from this idea.
- `# Why dropped` — only present when `status: dropped`; one or two sentences preserving the lineage so we don't re-relitigate next year.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `raw` | Just captured. May not have any structure yet. |
| `exploring` | Thinking about it actively; gathering signal. |
| `researching` | The `/flesh-out-idea` skill (or you) is doing research; `# Research notes` is being filled in. |
| `promoted` | Decided to do it. `promoted_to:` lists the spawned Task/Project/Effort. |
| `dropped` | Decided not to do it. `# Why dropped` records why. |
| `archived` | Old, irrelevant now, no decision to record. |

## Rules

- An idea can exist **without** a project or area. "I had a thought" is a valid initial state.
- Ideas don't have due dates — if you need a deadline, promote to a Task first.
- When promoting, set `status: promoted`, fill `promoted_to:`, and **don't delete** the idea — it's a record of why the spawned work exists.
- The `/flesh-out-idea` skill dispatches Sonnet sub-agents to gather research, then synthesizes as Opus. The skill writes into `# Research notes` and proposes content for `# Proposed first step`. It does not auto-promote — promotion is always a human call.
- An idea's `priority:` and `effort_estimate:` are best-guess; they're rough enough to filter on the Ideas dashboard, no more.
- **`status: dropped` requires a `# Why dropped` section.** When setting `status: dropped`, the idea must have a `# Why dropped` body section with one or two sentences explaining the decision — enough to keep the next iteration of you (or an agent) from re-litigating the same question a year later. The auditor flags `status: dropped` notes missing this section as `needs_review`.
- **`status: promoted` requires `promoted_to:` to be non-empty** and a `# Promoted to` section listing the spawned Task/Project/Effort wikilinks.
