---
name: revisit-decisions
description: Surface vault Decisions whose `revisit_on` date has fallen due and whose `outcome:` is still `pending`, prompt the user to mark the outcome (worked / partial / failed / superseded) and add a one-line `# Outcome` body entry. Use when the user wants the decision-feedback loop run — signaled by phrases like "revisit decisions", "check decision outcomes", "how did past decisions pan out", "any decisions due to revisit?", "decision retro", or direct invocation "/revisit-decisions". Auto-invoked by the weekly-review skill. Flag-and-prompt only — the user does the marking; the skill never sets `outcome:` itself. Reads `Atlas/Decisions/*.md`, filters by `revisit_on <= today AND outcome: pending`, presents each as a one-line summary + the original Decision + Rationale + Revisit trigger, asks the user for outcome + one-line note, then writes the user's response into the Decision note (sets `outcome:` and `outcome_notes:` in frontmatter, appends a dated `# Outcome` body entry). Append one log.md line per Decision marked.
---

# Revisit decisions

You are running as **`agent:auditor`** for this skill. Your job: surface Decisions whose `revisit_on:` date has fallen due and whose `outcome:` is still `pending`, prompt the user to grade the decision, then record the user's grading into the Decision note.

## Why this skill exists

The vault captures Decisions with `revisit_on:` dates but has no mechanism to actually circle back. Without this loop, Decisions accumulate as artifacts with no feedback signal — you can't tell over time whether your judgment in a given domain is well-calibrated, because nothing tracks outcomes. This is the smallest possible closing of that loop: a weekly pass that asks "the Decision you made N weeks ago hit its revisit date — what happened?"

The skill itself never grades a decision. It only surfaces, prompts, and records what the user says. The judgment stays with the user.

## Inputs

- **Date** (optional, default today). Only used to scope `revisit_on <= date`.
- **Limit** (optional, default 5). Max number of Decisions to surface per run, so a weekly pass doesn't bury the user.

## Step 0 — Orient

Read `_schemas/decision.md` to confirm the current `outcome:` enum and the `# Outcome` body section convention. Re-read every run — the schema may have evolved.

## Step 1 — Find due Decisions

Grep `Atlas/Decisions/*.md` for files where:

- `outcome: pending` (or missing — treat missing as pending for legacy notes)
- `revisit_on:` is set AND `revisit_on <= <date>`

Sort by `revisit_on` ascending (oldest-due first). Take the first `<limit>` entries.

If zero Decisions are due, write back: "No Decisions due for revisit" and stop. Don't write anything to log.md in the zero-case.

## Step 2 — Present each Decision

For each surfaced Decision, present to the user as a single chat block:

```
**[[<Title>]]** — decided <date>, revisit due <revisit_on>
Decision: <one-sentence statement from `decision:` frontmatter>
Rationale (top line from # Rationale): <first sentence>
Revisit trigger: <body content of # Revisit trigger>

Outcome? (worked / partial / failed / superseded) + one-line note:
```

Wait for the user to respond. Accept any of:
- One of the four enum values
- "skip" or "defer N weeks" — in which case bump `revisit_on:` forward by N weeks (default 4) and leave `outcome:` pending
- "supersede with [[Y]]" — set `outcome: superseded`, link the superseding decision, and the user should also run `capture-decision` separately on the new one if they haven't

## Step 3 — Record the user's response

For each Decision the user grades (not skip/defer):

1. Set frontmatter `outcome:` to the user's value.
2. Set frontmatter `outcome_notes:` to the user's one-line note.
3. Append a `# Outcome` body section (or a new dated entry if `# Outcome` already exists) of the form:
   ```
   ## <today>
   <user's one-line note, lightly cleaned up>
   ```
4. Bump `updated:` (the bump-updated hook will also catch this, but set it explicitly for cleanliness).

For deferrals: bump `revisit_on:` forward, do not touch `outcome:`, append a brief note in `# Outcome` ("deferred to <new date>: <user reason>").

## Step 4 — Log

For each Decision graded or deferred, append one line to `log.md`:

```
<datetime-with-tz> — agent:auditor — revisit — [[<Title>]] — outcome: <value>; <one-line note>
```

(Or `revisit — [[X]] — deferred to <date>` for skips.)

## Step 5 — Report back

```
Revisited <N> Decisions:
- <N-worked> worked
- <N-partial> partial
- <N-failed> failed
- <N-superseded> superseded
- <N-deferred> deferred

<one-line pattern observation if anything stands out — e.g., "3 of 5 failures were in the data pipeline project; consider a retro." Otherwise omit this line.>
```

## What this skill does NOT do

- **Does not grade a Decision itself.** The user grades; the skill records.
- **Does not surface Decisions whose `revisit_on:` is in the future.** Those are not yet due.
- **Does not auto-defer.** Skips are explicit user input.
- **Does not retroactively grade older `# Outcome` entries.** Append-only.
- **Does not change `status:` on the Decision** (which is `proposed | accepted | superseded | rejected` — a separate axis). `outcome:` is the new axis this skill operates on.

## Model recommendation

`sonnet`. This is structured retrieval + structured recording; no synthesis required. Opus is overkill.

## Related

- `_schemas/decision.md` — the schema with the `outcome:` enum and the `# Outcome` body section.
- `capture-decision` — the upstream skill that creates Decisions with `outcome: pending`.
- `weekly-review` — invokes this skill in its `## Learnings` section.
- `log-mutation` — the canonical log-append helper.
