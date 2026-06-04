---
name: promote-idea
description: Promote an Idea (status:researching or exploring) into a Task, Effort, or Project with proper bidirectional lineage (Idea→promoted_to, spawned→related_ideas) and a # Promoted to body section. Use whenever the user wants to promote an Idea (type:idea, status:researching or exploring) into a real Task, Effort, or Project — signaled by phrases like "promote this idea", "let's commit to this", "turn [[X]] into a project", "I'm ready to do this", "spawn a task from this idea", "convert this idea", or direct invocation "/promote-idea [[X]]". Walks the user through the choice of promotion target (Task vs Effort vs Project — uses the decision tree in _schemas/_types.md), writes the new note(s), backlinks bidirectionally (sets the Idea's status:promoted + promoted_to: + # Promoted to section; sets the new Task/Effort/Project's related_ideas: pointing back), and logs. Does NOT do the work itself — only sets up the lineage so the spawned commitment exists with the idea's research history attached. Use when the user has signaled real commitment ("I want to do this"); do not promote on speculation.
---

# Promote an idea into a Task / Effort / Project

You are running as **`agent:librarian`** for this skill. The user has an Idea note (`type: idea`, status probably `researching` or `exploring`) and wants to commit. Your job: write the spawned note(s) with the right lineage, update the Idea, and log — without doing the work itself.

## Why this skill exists

The Idea-to-commitment transition is a real moment of decision. The vault distinguishes:

- **Idea** — pre-commitment seed
- **Effort** — committed but unscoped
- **Project** — committed and outcome-bearing
- **Task** — discrete commitment

Picking the right level is hard, and the lineage (which Idea spawned this Project? where can I read the research that led to this commitment?) is easy to lose. This skill makes the promotion clean and forces a moment of "what level of commitment is this, actually?"

It also enforces the schema rule that `status: promoted` requires `promoted_to:` non-empty + a `# Promoted to` body section.

## Inputs

- **Idea note path or wikilink** (required) — e.g., `Atlas/Ideas/MCPs for Example U backend services.md` or `[[MCPs for Example U backend services]]`.
- **Optional promotion-target hint** — the user may say "promote to a task" or "promote to a project." Honor it but still ask the diagnostic questions in Step 2 if anything is ambiguous.

If no Idea is named, ask which before proceeding.

## Step 0 — Orient

Read these:

- The Idea note in full (especially `# Research notes` and `# Proposed first step` — these inform what to spawn).
- `_schemas/idea.md` — confirm the promotion rules.
- `_schemas/_types.md` — the **Idea vs Effort vs Project vs Task** decision tree.
- The relevant target schema (`_schemas/task.md`, `_schemas/effort.md`, or `_schemas/project.md`).

If the Idea's `# Research notes` is empty (status is still `raw` or `exploring` and no flesh-out has happened), **stop and suggest** the user runs `/flesh-out-idea` first. Promoting an un-researched idea is allowed but rarely the right move; flag it.

## Step 1 — Confirm commitment

The user said "promote." Confirm briefly:

> Promoting [[<Name>]]. The Idea will be marked `status: promoted` and won't be edited further (it becomes a record of why the spawned work exists). Continue?

If they hesitate, offer the alternative: `/flesh-out-idea` to research more, or `status: dropped` with a `# Why dropped` section.

## Step 2 — Pick the promotion target

Use the decision tree from `_schemas/_types.md`:

| If the user can write... | Promote to |
| --- | --- |
| ...a one-sentence concrete action with a clear "did it / didn't" check | **Task** |
| ...a paragraph-level outcome and at least one acceptance criterion | **Project** |
| ...neither — they're committed to investing time but can't yet name what done looks like | **Effort** |

Ask the user (one question at a time) to draft:

- **For Task:** the subject, the project this task lives under (often inferable from the Idea's `project:` or `area:`), the owner (default `me`), and the due date (offer 7 days as the default if they don't have one).
- **For Effort:** the subject, the area, the `promote_to_project_when:` trigger (the concrete event that would make this an Effort → Project promotion later).
- **For Project:** the subject, the area, a one-paragraph `# Outcome`, the phase (default `design`), and the next-review date (default today + 14 days).

You can promote to **multiple targets** if the user wants — e.g., one Project + two seed Tasks for that Project. Confirm the full plan before writing.

## Step 3 — Write the spawned note(s)

Create each spawned note per its schema. Critical: set `related_ideas: ["[[<Name>]]"]` in the frontmatter of every spawned note so the backlink is explicit.

For the body, **seed from the Idea's `# Research notes` and `# Proposed first step`** where it makes sense:

- **Task body:** the Idea's `# Proposed first step` often is the Task description. Lift it; cite the Idea as context.
- **Effort body:** the Idea's `# Research notes` → `# Evidence so far`. The Idea's open questions → `# Open questions`.
- **Project body:** the Idea's `# Why this could be worth doing` → `# Why this matters`. The Idea's `# Proposed first step` → seeds `# Current next actions` plus an inaugural Task.

Don't copy-paste blindly. Translate.

## Step 4 — Update the Idea note

Apply these edits to the Idea:

1. Frontmatter — **use `Edit` to replace existing fields in place; do NOT add a second block of the same key elsewhere in the frontmatter**:
   - `status:` — change `researching` (or `exploring`/`raw`) → `promoted` in place (single field).
   - `promoted_to:` — the Idea template seeds this as an empty array `promoted_to: []`. **Replace that empty placeholder line** with the populated YAML list pointing to every spawned note. **Do not** add a second `promoted_to:` block above or below — YAML rejects duplicate mapping keys and Quartz refuses to build the static site when a duplicate exists (Obsidian silently accepts last-value-wins, so the bug is invisible until Quartz fails). If the template doesn't have a `promoted_to:` line at all, add it once.
   - `updated:` — set to `<today>` (the `bump-updated.sh` PostToolUse hook will also do this; setting it explicitly is fine).
2. Add a `# Promoted to` body section (required by schema when status is `promoted`):

```markdown
# Promoted to

- [[<Subject>]] — <one-line characterization>
- [[<Subject>]] — <one-line characterization>
<etc.>

Promoted <date> via /promote-idea. Research notes above record what was known at the time of promotion.
```

The Idea note is now a **record**, not a work surface — don't edit `# Research notes` after this.

## Step 5 — Backlink the area / parent project

If the Idea had a `project:` or `area:` link in frontmatter, update that parent note's `related_ideas:` to include the Idea (and, optionally, update its `# Open loops` / `# Notes` section to mention the spawned commitment).

If the spawned note is a Project, also link it from the area's `# Active projects` section.

## Step 6 — Log

Append one line per spawned note to `log.md`:

```
<datetime> — agent:librarian — create — [[<spawned-note>]] — promoted from [[<Name>]]; <one-line summary>
<datetime> — agent:librarian — update — [[<Name>]] — promoted to <spawned-note(s)>; status researching → promoted
```

## Step 7 — Report back

```
[[<Name>]] promoted.

Spawned:
- [[<spawned-note-1>]] — <one-line>
- [[<spawned-note-2>]] (if any)

Idea status: researching → promoted
Idea body now has # Promoted to section.

Next suggested move:
- <if Task: "Start the task today / this week — it's bounded by <due-date>.">
- <if Effort: "Capture evidence as it arrives; promote to Project when <promote_to_project_when:>.">
- <if Project: "Schedule the first next-review on <date>; first Task to seed: <suggestion>.">
```

## What this skill does NOT do

- **Does not do the spawned work.** It sets up the commitment; the user (or another skill) executes.
- **Does not delete the Idea.** The Idea is the historical record.
- **Does not promote silently.** Always confirm with the user that they're really ready to commit before writing.
- **Does not skip the bidirectional backlink.** The Idea points to the spawned note(s) via `promoted_to:`; the spawned note(s) point back via `related_ideas:`. Both are required.
- **Does not handle "drop."** For `status: dropped`, the user edits the Idea directly with a `# Why dropped` section — no skill needed.

## Model recommendation

`opus`. The promotion-target choice (Task vs Effort vs Project) is a judgment call, and the body-seeding ("which research notes belong on the spawned Project's # Why this matters section?") is genuine synthesis work.

## Related

- `_schemas/idea.md` — the source schema; status-vocabulary and rules.
- `_schemas/_types.md` — the Idea vs Effort vs Project vs Task decision tree.
- `flesh-out-idea` skill — its sibling; runs first to fill `# Research notes` before promotion.
- `ingest-project` skill — if the promotion target is a Project with many sub-entities, you can delegate to `ingest-project` for the wider note-web around the new Project.
