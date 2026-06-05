---
name: capture-decision
description: Capture a deliberate choice as a Decision note (and handle the supersede chain when overriding a prior Decision). Use whenever the user announces a deliberate choice they want to be able to defend, revisit, or supersede later — signaled by phrases like "I've decided to ...", "let's go with X over Y", "the call is ...", "we're not doing Z because ...", "I'm picking X", "record this decision", "capture this as a decision", "log this decision", "decision: ...", or direct invocation "/capture-decision". Writes `Atlas/Decisions/<Title>.md` per `_schemas/decision.md` (frontmatter + the six required body sections: Decision, Rationale, Alternatives considered, Evidence, Consequences, Revisit trigger), links the decision from the parent Project or Area's body, and appends to `log.md`. Critically also handles the *supersede* path: when a new decision overrides a prior one, sets `supersedes:` on the new note and `status: superseded` + `superseded_by:` on the old note (decisions are append-only in spirit — never silently rewrite history). Use this any time the user states a non-trivial choice; without it, the why-this-not-that gets lost in chat and the project page lies about its current direction.
---

# Capture a Decision

You are running as **`agent:librarian`** for this skill. Your job: take one stated choice and write the typed Decision note, link it from the project/area it shapes, and (if it overrides an earlier decision) handle the supersede chain.

## Why this skill exists

Decisions are how the vault explains *why* it is the way it is. Without a Decision note, a project page is just a snapshot — six months from now the user (or a collaborator) opens it and asks "wait, why are we using approach X again?" and the answer is gone.

Three failure modes this skill prevents:

1. **The decision lives in chat and dies there.** A choice mentioned in a session log is invisible from the project page.
2. **The decision is implicit in the project page's prose.** The reader has to reverse-engineer the rationale and the alternatives that were rejected. The Decision schema forces both into structured slots.
3. **Decisions get silently rewritten.** If the project changes direction, someone updates the project page and the old rationale vanishes. The supersede convention (one Decision note per choice, linked via `supersedes:` / `superseded_by:`) preserves history.

It's also a small enough thing — a Decision note is ~10 minutes of writing — that the friction of doing it cleanly is what stops it from happening. Skill removes the friction.

## Inputs

- **Decision statement** (required) — one sentence stating the choice. "We're switching from approach X to approach Y for reason Z" or "We're not pursuing the ExampleCo partnership until H2."
- **Parent** (required for non-personal decisions) — Project, Area, or Concept wikilink. A decision must shape *something*.
- **Supersede pointer** (optional) — if the user references an earlier Decision note, capture the wikilink so the supersede chain can be wired.
- **Rationale** (often given inline; otherwise prompt for one tight paragraph).
- **Alternatives considered** (prompt if not offered — even "no real alternative" is worth recording).

## Step 0 — Orient

Read these in parallel:

- `_schemas/decision.md` — re-read every invocation; the schema is short and worth getting right.
- The parent Project / Area page in full — you'll need its `# Key decisions` section (or equivalent) to add a link to the new Decision.
- If a supersede target was named, that Decision note in full — you'll modify its frontmatter.
- The last ~10 lines of `log.md`.

Then: **search the existing Decisions folder** for similar titles. If a Decision note already exists on the same topic, don't create a parallel one — either update it (if the user is refining the same decision) or supersede it (if this is a new call on the same question).

## Step 1 — Confirm the shape (one tight check, not an interrogation)

Echo back what you're about to write:

> Writing [[<Title>]] under [[<Parent>]], status `accepted`, date today. Supersedes: <none | [[X]]>. Confirm — or want to tighten the title / rationale?

If the title is obvious from the decision statement, don't ask separately for a title — derive it. Conventions from existing Decisions in the vault: short noun phrase (`Decision - Append-only log.md`, `Decision - Trackers as a primitive for living topics`), not a sentence.

## Step 2 — Write the Decision note

Path: `Atlas/Decisions/<Title>.md`. **First run `<Title>` through `safe_title` (see `CLAUDE.md` / `AGENTS.md` → "A note's title IS its filename"): ` / ` → ` and ` (bare `/` → `-`), drop `:` and the rest of `\ * ? " < > | # ^ [ ]`, collapse/trim spaces.** That one sanitized string is the filename stem, the `title:` value, and the target of every `[[<Title>]]` wikilink — identical, or the link 404s in Quartz. (The `id: dec-<slug>` below is the separate kebab-case form.) Conform to `_schemas/decision.md` exactly.

Frontmatter rules worth precision:

- `id: dec-<slug>` — the slug is a kebab-case version of the title (`dec-append-only-log-md`).
- `status: accepted` is the default for a fresh decision being made now. Use `proposed` only if the user explicitly says "we're considering this but haven't committed."
- `date:` is today (when the decision was made).
- `decision:` is the **one-sentence statement** — distinct from the title. Title is the noun phrase; `decision:` is "we will / we will not ...".
- `revisit_on:` — if the decision has a natural review trigger (e.g., "revisit when we have pilot data" or a date), set it. If not, set it to today + 6 months as a default; the auditor will surface it then.
- `project:` and `area:` — both, when both apply. Wikilinks are quoted strings: `project: "[[ExampleProject Platform]]"`.
- `supersedes:` is a list — usually empty, but a list of one wikilink when superseding.

Body — all six sections per the schema, each given real content (don't write "TBD"):

- `# Decision` — restate in one paragraph (a bit more context than the frontmatter `decision:` field).
- `# Rationale` — why this, not the alternatives. The "compared to what, evaluated on what" question.
- `# Alternatives considered` — bulleted list. Each alternative gets one line for the alternative itself and one line for "why not." Even if the user only seriously considered one alternative, list it; the trace matters.
- `# Evidence` — links to sources (`[[X]]`), prior decisions, conversation threads. If the evidence is "personal experience with no citable source," say so.
- `# Consequences` — what this commits to and what it forecloses. Be honest about the foreclosure side; that's the part that helps future-you understand the constraint.
- `# Revisit trigger` — what concrete event or date would make us reopen this. Repeats / amplifies the frontmatter `revisit_on:`.

## Step 3 — Backlink from the parent

Open the Project or Area page. Add a bullet under `# Key decisions` (creating the section if it's missing) pointing at the new Decision note. One line:

```
- <date> — [[<Title>]] — <one-line characterization>
```

Bump the parent's `updated:` to today.

If the Decision also shapes a Concept page, add the bullet there too.

## Step 4 — Handle supersede (when applicable)

If the new Decision supersedes an existing one:

1. On the **new** note: `supersedes: ["[[<Old Title>]]"]`.
2. On the **old** note:
   - `status: superseded`
   - `superseded_by: "[[<New Title>]]"`
   - `updated:` → today
3. Add a one-line note at the bottom of the old Decision's `# Consequences` section: "Superseded <today> by [[<New Title>]] — <one-line reason>."

**Do not** edit the old note's `# Decision`, `# Rationale`, `# Alternatives considered`, `# Evidence`, or `# Revisit trigger` sections. Decisions are append-only in spirit (per `_schemas/decision.md`); you're recording that the old call was overridden, not rewriting what was true at the time.

## Step 5 — Log

Append one line to `log.md`:

```
<datetime-with-tz> — me — create — [[<Title>]] — <one-line summary>; shapes [[<Parent>]]<; supersedes [[<Old>]]>.
```

If a supersede also happened, append a second line for the old note's status update:

```
<datetime-with-tz> — me — update — [[<Old Title>]] — status accepted → superseded; superseded_by [[<New Title>]].
```

## Step 6 — Open in browser via Quartz (default)

The artifact is the new Decision note at `Atlas/Decisions/<title>.md`. The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/Decisions/<title>"
```

For the supersede case (Step 4), open the *new* Decision, not the superseded one. Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 7 — Report back

```
[[<Title>]] captured.
- Status: <accepted | proposed>
- Parent: [[<Name>]] (added to # Key decisions)
- Supersedes: <none | [[<Old>]] (now status: superseded)>
- Revisit on: <date or trigger>
```

If the decision has obvious downstream consequences — a Task that should now be created, a Tracker that should be deactivated, a project page section that should be updated — propose those as follow-ons in one line. Don't act on them in this skill.

## What this skill does NOT do

- **Does not rewrite history.** Old Decisions get `status: superseded` and a `superseded_by:` pointer, not deletions or rewrites of the body.
- **Does not capture trivialities.** A choice like "let's use `.md` not `.txt`" doesn't need a Decision note — those live in `_schemas/` or `CLAUDE.md`. Decisions are for non-trivial, defensible, revisit-able choices. If the user is invoking this for something that doesn't pass the "would I want to defend this in six months?" test, push back lightly.
- **Does not enact the decision's consequences.** If the decision is "switch from X to Y," this skill writes the note and the backlink — it does not also create the migration Task, deactivate trackers, etc. Surface those as follow-ons.
- **Does not silently downgrade `accepted` to `proposed`.** If the user is wavering, ask whether to commit or whether to record as `proposed` and revisit.

## Model recommendation

`opus` (inherited). The rationale / alternatives / consequences sections need real thought, and the supersede mechanics need precision. Don't downshift.

## Related

- `_schemas/decision.md` — re-read every invocation.
- The existing Decision notes under `Atlas/Decisions/` — useful as tone/format precedents.
- `weekly-review` — surfaces "decisions to revisit" based on the `revisit_on:` field.
- `log-mutation` — the canonical helper for the `log.md` append.
