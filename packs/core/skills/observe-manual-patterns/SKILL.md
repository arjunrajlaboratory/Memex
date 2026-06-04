---
name: observe-manual-patterns
description: Scan `log.md` for `actor:me` mutations that were NOT wrapped in a known skill invocation, bucket by (verb, target-type), and flag any pattern occurring 3+ times in the last 30 days as a candidate for codifying into a new skill. Use when the user wants the manual-pattern observation pass run — signaled by phrases like "what should be a skill", "any patterns in my manual work", "what am I doing repeatedly", "find skill candidates", "observe manual patterns", or direct invocation "/observe-manual-patterns". Auto-invoked by the weekly-review skill. Reads `log.md`, identifies lines with `actor:me` and a verb that doesn't correspond to a vault skill, groups by mutation shape, and writes a small ranked report into the open weekly review or a standalone `Ops/Reviews/Observations/Manual patterns - <ISO-week>.md`. Flag-only — proposes skill candidates but never creates a skill.
---

# Observe manual patterns

You are running as **`agent:auditor`** for this skill. Your job: detect repeated `actor:me` mutations in `log.md` that don't yet have a skill wrapping them, surface them as skill-creation candidates.

## Why this skill exists

The vault's 16 hand-written skills were created when the user noticed a pattern: "I keep doing X manually, this should be a skill." This observer makes that detection systematic — instead of relying on the user noticing, it scans the canonical mutation log and flags repeated shapes.

The cost of NOT having this observer: useful skills get created late, after the user has done the same manual work 8–10 times. The value is short-circuiting the "I noticed too late" pattern.

## Inputs

- **Window** (optional, default 30 days). The scan window from `log.md`.
- **Threshold** (optional, default 3). Minimum count for a pattern to be surfaced.

## Step 0 — Orient

Read these to know the universe of existing skills (so you don't recommend creating a skill that exists):

- `ls .claude/skills/` — list of installed skills.
- `ls Agents/Prompts/` — paste-able prompts (each prompt is a skill candidate already documented).

Note: the canonical log line shape from `AGENTS.md` is:
```
<datetime> — <actor> — <verb> — <[[target]]> — <one-line summary>
```

Where `actor` is one of `actor:me`, `agent:planner`, `agent:auditor`, `agent:librarian`, `agent:capture`, etc.

## Step 1 — Filter the log

Read the last `<window>` days of `log.md`. Filter to lines matching `actor:me`. Drop lines whose verb matches a known skill-equivalent operation (since `actor:me` here means the user themselves did it, NOT through a skill). The relevant verbs to KEEP (i.e., what the user did manually) include but are not limited to:

- `update`, `schedule`, `commit`, `publish`, `send`, `move`, `rename`, `link`, `tag`, `delete`, `restore`, `convert`, `merge`, `archive`

The verbs to DROP (these correspond to existing skills, even when `actor:me` invoked them — the action shape itself is already a skill):

- `create` of a typed note (covered by `create-task`, `capture-decision`, `ingest-source`, `ingest-person`, `ingest-project`)
- `triage`, `brief`, `review`, `lint`, `promote`, `flesh-out`, `close`, `revisit`, `observe`, `digest` (each is a named skill)

## Step 2 — Bucket by shape

For each kept line, extract a normalized shape:

```
<verb> <target-type>
```

Where `target-type` is inferred from the wikilink target (e.g., `[[X]]` → `person`, `[[Y]]` → `task`, `[[Z]]` → `decision`, `[[W]]` → `project`). If the target isn't a vault entity (e.g., "Google Calendar event for ...", "GitHub repo X"), use the target's category as the type (`calendar-event`, `external-repo`, `email-draft`).

Group by shape. Count occurrences. Drop shapes with fewer than `<threshold>` occurrences.

## Step 3 — Format the report

```markdown
## Manual patterns — <window>

| Shape | Count | Example log lines |
| --- | --- | --- |
| `update person.last_contact` | 5 | 2026-05-12 — actor:me — update — [[X]] — last_contact bump; 2026-05-17 — ... |
| `schedule calendar-event` | 4 | 2026-05-09 — actor:me — schedule — Google Calendar event for ...; ... |
| ... | ... | ... |

### Proposed skill candidates
- **<verb-target>**: candidate skill `<suggested-name>` — <one-line shape of what the skill would do>.
  - Frequency: <count> in <window> days. Examples: <up to 3 target wikilinks>.
```

If there are zero patterns above threshold, write: "No repeated manual patterns above threshold (`<threshold>`) in the last `<window>` days."

## Step 4 — Persist the report

Two paths (same as `observe-skill-corrections`):

- **Open weekly review for this ISO week** — append the `## Manual patterns — <window>` section.
- **No open weekly review** — write a standalone `Ops/Reviews/Observations/Manual patterns - <ISO-week>.md`. Frontmatter: `type: review`, `scope: observation-manual-patterns`, `date: <today>`, `generated_by: agent:auditor`, `sensitivity: private`.

## Step 5 — Log

```
<datetime-with-tz> — agent:auditor — observe — [[<output file>]] — manual-patterns; <N patterns above threshold>; top: <shape> @ <count>
```

## What this skill does NOT do

- **Does not create any skill.** Proposals only. The user runs `superpowers:writing-skills` (or hand-writes) the new skill if they accept the proposal.
- **Does not de-duplicate against `Agents/Prompts/`**. If a proposed skill already exists as a paste prompt but not as a `.claude/skills/` entry, surface it anyway — that's a different kind of suggestion (promote the prompt to an auto-skill).
- **Does not infer intent beyond shape.** "Update person.last_contact 5 times" might mean the user wants a `bump-contact` skill, or might mean they had a busy week with many follow-ups. The report surfaces; the user decides.

## Model recommendation

`sonnet`. Structured grep over a small file + grouping. No judgment required beyond verb classification.

## Related

- `weekly-review` — invokes this skill in its `## Learnings` section.
- `observe-skill-corrections` — sibling observer; scans transcripts instead of log.md.
- `superpowers:writing-skills` — the skill the user would invoke if they accept a proposed candidate.
- `log-mutation` — the canonical log-append helper.
