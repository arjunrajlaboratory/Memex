# Workflow: lint

**Role:** `agent:auditor`
**Trigger:** weekly (Friday) or on demand
**Output:** an append-only section in the next weekly review, plus one needs-review task per material finding

## Checks

For each, produce a list of offending notes (wiki-linked).

1. **Broken wikilinks.** Every `[[X]]` resolves to a file. Also flag any `[[X]]` whose target contains `/ : # | ^` even if a same-named file seems to exist: inside `[[...]]` Quartz parses `/` as a path separator and `#`/`^` as anchors, so `[[A / B]]` silently resolves to a bogus `/A-/-B` path and 404s. Such a link almost always means the target note's title was never run through `safe_title` (see check #20).
2. **Stale active projects.** `status: active` AND no update in `next_review` window × 1.5.
3. **Orphan tasks.** `type: task` AND no `project:` AND no `area:`.
4. **Orphan projects.** `status: active` AND no `Current next actions` entries.
5. **Unprocessed sources.** `status in [new, unprocessed]` AND `captured` older than 7 days.
6. **Duplicate entities.** Two notes with similar titles or overlapping `aliases:`.
7. **Contradictory claims.** Same proposition stated differently on two wiki pages (heuristic; flag for human).
8. **Overdue waiting-for.** Task `status: waiting` AND `updated` older than 14 days.
9. **Stuck agent jobs.** `status: needs_review` AND `updated` older than 7 days.
10. **Draft asks.** Ask `status: draft` AND created >30 days ago.
11. **Lapsed people.** Person `next_touch < today` AND `status: active`.
12. **Broken trackers.** Tracker `status: broken` — needs URL/feed repair.
13. **Quiet trackers.** Tracker `miss_count >= 5` — propose cadence lengthening.
14. **Sensitivity leaks.** Any note that links a `sensitive` note from a file under `Drafts/` or `outputs/`.
15. **Schema drift.** Any note missing a required field per its `type:` schema.
16. **Schema enum violations.** Any field whose value is outside the schema's declared enum. Spot the common offenders:
    - `type: source` notes with `status:` not in `[new, unprocessed, processing, processed, needs_review]` (e.g., `status: ingested` is a frequent miscoding).
    - `type: task` notes with `status:` not in `[inbox, backlog, next, scheduled, in_progress, waiting, needs_review, done, canceled]`.
    - `type: project` notes with `status:` not in `[active, paused, waiting, archived, done, dropped]`, or `phase:` not in `[idea, design, building, shipping, maintaining]`.
    - `type: person` notes with `status:` not in `[active, dormant, estranged, deceased, archived]`.
    - `type: idea` notes with `status:` not in `[raw, exploring, researching, promoted, dropped]`.
    - `type: decision` notes with `status:` not in `[accepted, superseded, rejected]`.
    - `type: tracker` notes with `status:` not in `[active, paused, archived, broken]`.
    For each, the schema in `_schemas/<type>.md` is canonical. Flag both the offending value AND the correct enum so the user can fix it.
17. **Required-evidence gaps.** Sources with `raw_path:` empty or pointing at a non-existent file. Decisions with `# Evidence` empty when `status: accepted` is set. Person notes claiming `# Important personal context` items without an Interaction reference (per the schema's "never invent personal facts" rule).
18. **Missing-entity queue gaps.** Per the `# Missing-entity queue convention` in AGENTS.md: when an ingest-* skill creates a wikilink to a missing entity, it should have spawned either the entity or a `Followup - Create <Type> - <Name> - <date>` tickler. Find broken wikilinks (check 1) that don't have a corresponding Followup in `Ops/Followups/` — those are the missed queue entries.
19. **Planned-vs-done blur.** Person notes with `last_contact: <future-date>` — `last_contact:` should always be ≤ today (the date of the most recent *actual* bilateral exchange). Future-dated values usually indicate a queued/scheduled outreach was mis-coded as a completed contact. Flag for the user to revert (the convention is `last_contact:` updates only after the send confirms).
20. **Title ↔ filename drift.** For every typed note, the filename stem must equal `safe_title(title:)` (per `_schemas/_types.md` → "Filenames and titles" and `AGENTS.md`/`CLAUDE.md`). Flag any note where the on-disk filename and the `title:` (or `name:`) field disagree — e.g. a `title:` containing `/` or `:` that the filesystem dropped or altered. This is the **upstream cause** of most check-#1 broken wikilinks: when the title drifts from the filename, every `[[title]]` written elsewhere points at the title form, not the file. Lean high-severity — it breaks links silently and fans out. For each hit, report the filename, the `title:`, and the `safe_title(title:)` the file *should* be named. (Date/id-derived filenames — journals, briefings, reviews, agent jobs/runs — are exempt; their names aren't title-derived.)
