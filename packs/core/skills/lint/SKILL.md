---
name: lint
description: Run the 20-check vault hygiene audit (broken wikilinks, title↔filename drift, stale projects, orphan tasks, duplicate entities, broken trackers, sensitivity leaks, schema drift, schema enum violations, required-evidence gaps, missing-entity queue gaps, planned-vs-done blur, etc.) and write a flag-only report; proposes follow-on tasks but creates none. Use whenever the user wants the vault hygiene audit run — signaled by phrases like "run the lint", "audit the vault", "do a vault lint", "auditor pass", "vault hygiene check", "what's broken in the vault", "find the orphan tasks", "any broken wikilinks?", or direct invocation "/lint". Executes the 20-check auditor pass from `_workflows/lint.md` (broken wikilinks, title↔filename drift, stale active projects, orphan tasks / projects, unprocessed sources, duplicate entities, contradictory claims, overdue waiting-for, stuck agent jobs, draft asks, lapsed people, broken trackers, quiet trackers, sensitivity leaks, schema drift) and produces a structured markdown report with per-check counts, example wikilinks, and severity ratings. For each material finding, *proposes* (but does not create) a needs-review task with the suggested next action. Appends the report as a new `## Auditor findings — <YYYY-MM-DD>` section to the current weekly review if one is open, otherwise writes a standalone `Ops/Reviews/Lint - <date>.md`. Flags only — never changes file status, content, or frontmatter. Use weekly (Friday afternoon before the weekly review) or on demand when vault hygiene is in question. Skill is the auto-triggering counterpart to the paste prompt at `Agents/Prompts/lint.md`.
---

# Lint the vault

You are running as **`agent:auditor`** for this skill. Your job: run the 20 checks defined in `_workflows/lint.md`, produce a structured report, and propose follow-on tasks — without changing any file's status, content, or frontmatter. The auditor flags; the user decides.

## Why this skill exists

Vault hygiene degrades silently. A wikilink breaks because a note was renamed. A project sits `active` while its actual work has migrated. A Task gets `status: waiting` and nobody chases the waiting-on. A Source piles up unprocessed for two weeks. The system works *most* of the time without these failing visibly, which is exactly what makes them dangerous — by the time the user notices, the corruption is structural.

The lint pass is the cheap, periodic defense. It doesn't fix anything (that's the user's call); it surfaces the 15 known failure modes and lets the user triage. The procedure has lived as a paste prompt at `Agents/Prompts/lint.md` and a workflow at `_workflows/lint.md`. This skill wraps both for natural-language invocation.

## Inputs

- **Date** (optional, default today) — only used to label the output file.
- **Scope** (rare) — the user can request a partial run: "just check broken wikilinks" or "skip the schema-drift check." Honor a scope hint; default is all 20.

## Step 0 — Orient

Read these in full before doing anything:

- `AGENTS.md`.
- `_workflows/lint.md` — the canonical procedure with the 20 checks. Re-read every invocation.
- The most recent weekly review under `Ops/Reviews/` to see if one is currently open (i.e., dated this ISO week) — that's where the report will land if so.

## Step 1 — Run the 20 checks (in order)

Per `_workflows/lint.md`:

1. **Broken wikilinks** — `[[X]]` where no `X.md` (or matching note) exists. Also flag any `[[X]]` whose target contains `/ : # | ^`: Quartz parses `/` as a path separator inside `[[...]]`, so `[[A / B]]` resolves to a bogus `/A-/-B` and 404s even if a file exists. These are downstream of title↔filename drift (check #20).
2. **Stale active projects** — `status: active` AND (no Task updates in >14 days OR `next_review < today`).
3. **Orphan tasks** — `type: task` with neither `project:` nor `area:` set.
4. **Orphan projects** — `status: active` with no Task referring back via `project:`.
5. **Unprocessed sources** — `status: new` or `status: unprocessed` AND `captured >7 days ago`.
6. **Duplicate entities** — similar titles or overlapping aliases. Be conservative; surface candidates rather than confidently declaring duplicates.
7. **Contradictory claims** — the same proposition stated differently across wiki pages. The hardest check; surface only obvious mismatches.
8. **Overdue waiting-for** — `status: waiting` AND `updated >14 days ago`. Surfaces stalled commitments.
9. **Stuck agent jobs** — `status: needs_review` AND `updated >7 days ago`.
10. **Draft asks** — `type: ask` with `status: draft` AND `created >30 days ago`.
11. **Lapsed people** — `type: person`, `status: active`, AND `next_touch < today`.
12. **Broken trackers** — `status: broken`.
13. **Quiet trackers** — `miss_count >= 5`.
14. **Sensitivity leaks** — anything in `Drafts/` or `outputs/` that links to a note with `sensitivity: sensitive` or `sensitivity: private`.
15. **Schema drift** — notes missing required fields per their type's schema in `_schemas/`.
16. **Schema enum violations** — any field whose value is outside the schema's declared enum. Common offenders: Source with `status: ingested` (not in the source-status enum), Tasks with non-canonical statuses, Decisions with `status: pending` (not a valid decision-status). Flag both the offending value AND the correct enum.
17. **Required-evidence gaps** — Sources with empty `raw_path:` or pointing at a missing file; accepted Decisions with empty `# Evidence`; Persons claiming `# Important personal context` items with no Interaction reference (per the schema's "never invent personal facts" rule).
18. **Missing-entity queue gaps** — per the missing-entity queue convention in `AGENTS.md`, broken wikilinks that don't have a corresponding `Followup - Create <Type> - <Name>` in `Ops/Followups/` are missed queue entries. Subset of check 1 with the convention overlay.
19. **Planned-vs-done blur** — Person notes with `last_contact: <future-date>`. `last_contact:` must always be ≤ today (last actual bilateral exchange). Future-dated values usually indicate a queued/scheduled outreach was miscoded as completed.
20. **Title ↔ filename drift** (see `_schemas/_types.md` → "Filenames and titles") — **(a)** flag any filename stem containing `/ : \ * ? " < > | # ^ [ ]` (the upstream cause of most check-#1 broken wikilinks — links elsewhere point at the raw form, not the file); **(b)** for notes whose filename derives from a field — Task/Idea (`title:`), Organization/Person (`name:`) — also flag when the stem ≠ `safe_title` of that field. **Exempt from (b):** date/id-named notes (journals, briefings, reviews, agent jobs/runs), and **Grant** (its `title:` is the full proposal title, intentionally ≠ the short filename — apply only (a)). Types with no title field (Source, Decision, Project, Concept, Tracker, Effort, Area, Implementation) get (a) only. Lean high-severity. Report the filename, the offending field if any, and the `safe_title` form it should use.

For each check, gather:

- **Count** — number of offending notes.
- **Examples** — up to 5 wikilinks; if more, append "… and N more."
- **Severity** — `critical` / `high` / `medium` / `low`. Use the rubric in `_workflows/lint.md`; if absent, judge by impact (sensitivity leaks and broken wikilinks lean critical; quiet trackers lean low).

Run the checks in parallel where possible (the read-only ones can fan out across Read/grep tool calls). Some checks (6 and 7) need cross-note synthesis and can't be parallelized.

## Step 2 — Format the report

```markdown
## Auditor findings — <today>

| # | Check | Count | Severity | Examples |
| --- | --- | --- | --- | --- |
| 1 | Broken wikilinks | <N> | <sev> | [[X]], [[Y]] (and N more) |
| 2 | Stale active projects | <N> | <sev> | [[X]] |
| ... | ... | ... | ... | ... |
| 15 | Schema drift | <N> | <sev> | [[X]] (missing `priority:`) |

### Proposed needs-review tasks

For each material finding (Count > 0, Severity >= medium):

- **<one-line task title>** — parent: <project or area>; suggested next action: <one-liner>.
  - Affects: [[X]], [[Y]], +N more.
```

Order proposed tasks by severity (critical first, then high, then medium). Cap at ~10; if more than that surface, write "+N additional findings — see table above" and stop.

## Step 3 — Persist the report

Two paths:

- **A weekly review is open this ISO week** — find `Ops/Reviews/Review - <ISO-week>.md` (e.g., `Review - 2026-W20.md`). Append the `## Auditor findings — <today>` section to its bottom. Bump the review's `updated:`.
- **No open weekly review** — write a standalone `Ops/Reviews/Lint - <today>.md`. Frontmatter: `type: review`, `scope: lint`, `date: <today>`, `generated_by: agent:auditor`, `sensitivity: private`.

If a previous lint report exists for the same day, append a new `## Auditor findings — <today> (re-run @ HH:MM)` section rather than overwriting. The history matters.

## Step 4 — Seed-data exception

Notes tagged `(example)` in their title or body are intentional seed data through Task 7.9 of the original build. Don't treat them as real findings requiring action — include them in counts for completeness but annotate the line as `(example — seed data, ignore until Task 7.9)`.

This exception sunsets once Task 7.9 closes; check `Ops/Tasks/` for the Task 7.9 status before applying it. (If 7.9 is `done`, drop the exception and treat example-tagged notes normally.)

## Step 5 — Log

Append one line to `log.md`:

```
<datetime-with-tz> — agent:auditor — lint — [[<output file>]] — <N> findings (<N-critical, N-high, N-medium, N-low>); appended to <weekly-review | standalone lint file>.
```

## Step 6 — Open in browser via Quartz (default)

The artifact is either the standalone lint report (`Ops/Reviews/Lint - <date>.md`) or the open weekly review you appended findings to (`Ops/Reviews/Review - <week>.md`). The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > {{VAULT_PATH}}/outputs/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
# Standalone case:
open "http://localhost:{{QUARTZ_PORT}}/Ops/Reviews/Lint - <date>"
# Or, if appended to an open review:
open "http://localhost:{{QUARTZ_PORT}}/Ops/Reviews/Review - <week>"
```

Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 7 — Report back

```
Lint pass complete.
- 20/20 checks run
- Findings: <N total> (<N-critical, N-high, N-medium, N-low>)
- Most consequential: <one-line on the highest-severity finding>
- Report: [[<output file>]]

Proposed <N> needs-review tasks (not created — review and accept individually).
```

## Step 7 — Hand-off (do not auto-create)

After the report is persisted, do **not** create the proposed needs-review Tasks. Surface them in the report and the chat wrap-up; the user runs `/create-task` for the ones they accept.

If the user wants to bulk-accept the proposed Tasks, that's a follow-on instruction — and they'd run `/create-task` for each, or you'd dispatch parallel `/create-task` invocations.

## What this skill does NOT do

- **Does not fix anything.** Flag-only is the contract. The auditor proposes; the user decides.
- **Does not delete or archive.** Even an obviously dead note stays put — the user reviews and acts.
- **Does not write to `Raw/` or change `sensitivity`.** Both are hard-no per `CLAUDE.md`.
- **Does not run partial checks silently.** If a check is being skipped (because the user scoped it out, or because a required folder is missing), call that out in the report explicitly.
- **Does not create the proposed Tasks.** Even when the user says "accept all," the path goes through `/create-task` — the lint skill ends with the report and the proposals.

## Model recommendation

`opus` for checks 6 (duplicate entities) and 7 (contradictory claims) — these need genuine cross-note judgment. The other 13 are mostly mechanical and could in principle be done with `haiku`, but the overhead of dispatching isn't worth it for the weekly pass.

## Related

- `Agents/Prompts/lint.md` — paste-able prompt equivalent.
- `_workflows/lint.md` — the canonical procedure with the 20 checks.
- `weekly-review` — its "Auditor findings" section is filled in by this skill when run within the same week.
- `create-task` — what the user runs to accept proposed lint Tasks.
- `log-mutation` — the canonical log-append helper.
