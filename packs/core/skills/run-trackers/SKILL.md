---
name: run-trackers
description: >-
  Run every active due Tracker, or one named Tracker, according to its search
  strategy and material-change criteria. Use for "run the trackers", "run due
  trackers", "check tracker updates", "Monday tracker pass", "any new
  digests", or `/run-trackers`. Supports web, feeds, releases, papers, manual
  prompts, and vetted tools. Write the governed Tracker Digest, apply or
  propose update targets according to policy, update
  bookkeeping, log the run, and honor forbidden actions and sensitivity.
---

# Run due trackers

You are running as **`agent:tracker`** for this skill. Your job: bring every active, due tracker up to date by executing its search recipe, producing a digest, and updating the tracker's bookkeeping fields — without overstepping its `forbidden_actions`.

## Why this skill exists

Trackers are the vault's mechanism for watching topics that change over time without the user having to remember to check. Each tracker has a search recipe, a cadence, a material-change definition, and a contract for what it's allowed to update on its own. The mechanics are non-trivial — `_schemas/tracker.md` has a dozen fields and `_schemas/tracker_digest.md` has six required body sections.

The procedure already lives in canonical form at `_workflows/run-tracker.md`. This skill is the auto-triggering wrapper so a phrase like "run the trackers" or "anything new from the ExampleTracker tracker?" doesn't require pasting the prompt.

The thing that goes wrong without this skill: trackers get stale, miss-counts climb invisibly, and what was supposed to be the vault's signal-on-the-world goes silent. The auditor catches it eventually (`miss_count >= 5` → `status: needs_review`), but a tracker that's been silent for five misses is a tracker that's effectively dead.

## Inputs

- **Tracker id** (optional) — e.g., `tracker-example-llm-wiki` or `[[ExampleProject releases]]`. If omitted, runs all active + due trackers.
- **Force flag** (rare) — if the user says "run the tracker even though it isn't due," honor it only when that tracker has no digest for today, and note in the digest's `# What I looked at` that this was an off-cadence run. Force bypasses cadence, not the one-run-per-day guard.

## Step 0 — Orient

Read these in full before doing anything:

- `AGENTS.md`.
- `_workflows/run-tracker.md` — the canonical procedure. Re-read every invocation.
- `_schemas/tracker.md` and `_schemas/tracker_digest.md`.

## Step 1 — Determine the run set

Build the candidate pool before applying cadence or status filters: load the named tracker when one
was given; otherwise list every tracker file in `Atlas/Trackers/` (not `Digests/`). For every
candidate, resolve today's expected digest path,
`Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md`, and inspect the digest, the tracker
references, and `log.md` first.

Classify each candidate before deciding whether it is normally eligible:

- **Completed:** the digest has `status: complete` and `plan_status: complete`,
  `verified_outputs` exactly equals `planned_outputs` in the same order, every target still
  verifies, `last_digest` points to it, `# History` links to it, and `log.md`
  contains the matching `agent:tracker` line with that digest link. Skip it and report "already
  ran today"; for an explicitly named tracker, stop. A force flag does not override this
  completed-run guard. Do not overwrite a completed digest.
- **Legacy completed:** a same-day digest created before this contract has `status: complete` but
  no `plan_status`, while `last_digest`, `# History`, and the digest-linked `agent:tracker` log line
  all verify. Skip it without mutation, report "already ran today (legacy completion evidence),"
  and surface that its planned outputs cannot be re-verified. Never upgrade or overwrite it.
- **Drifted complete:** any `status: complete` digest is missing required output/reference evidence
  (including a legacy digest missing one of its three references). This is post-completion integrity
  drift, not an interrupted run. Do not reapply outputs, repair references, rerun discovery, or
  rewrite the digest; surface manual integrity review.
- **Recoverable:** any `status: partial` or `failed` digest has `plan_status: complete`—meaning all
  required sections, deterministic outputs, and pre-run bookkeeping are frozen. Add it to the
  recovery run set **before** normal
  `status`/`next_check` filtering and process it first, even if Step 2.6 already advanced
  `next_check` or set `status: needs_review`. The recorded snapshot is authoritative: do not rerun
  searches or change its output plan. Resume at the first incomplete write using the same digest
  path. `verified_outputs` must be an ordered prefix of `planned_outputs`; otherwise stop for
  manual integrity review. This includes a run where every target/reference verifies and only the
  final `status: complete` transition is missing. Never create a second same-day digest or rewrite
  a completed digest.
- **Safe to re-plan:** a partial or failed digest has `plan_status: building`, all progress mirrors
  (`verified_outputs`, the output arrays, and `# What I changed`) are empty, and no downstream
  output, tracker field, History entry, or log line has been written. Re-run only the
  read-only discovery/scoring steps, finish the plan in that same digest, and then continue. This
  is recovery work and bypasses normal eligibility filtering.
- **Blocked recovery:** an incomplete digest has no `plan_status`; a digest is missing while a
  same-day write/reference exists; or a `plan_status: building` digest has any nonempty progress
  field, downstream write, or completion reference. Without an unambiguous write-ahead state,
  deterministic recovery is impossible. Do not rerun discovery, create a digest, or mutate
  anything; surface manual recovery with the conflicting evidence.
- **Fresh:** the digest is absent and no same-day `last_digest`, `# History`, or `log.md` reference
  exists. For a batch, include it only when `status: active` and `next_check <= today`. An explicit
  request (or force request) may bypass cadence, but not the completed-run guard. Skip a fresh
  `status: broken` tracker; skip and surface a fresh `status: needs_review` tracker.

The run set is recoverable and safe-to-re-plan trackers first, then eligible fresh trackers. If it is empty, report
"no trackers due — next due <date> for <tracker>" and exit. Don't invent work.

## Step 2 — For each selected tracker, follow the recipe

Loop over the run set. For each tracker, run these steps in order (this is `_workflows/run-tracker.md` distilled):

For a recoverable run, use the digest's recorded discovery results, materiality decisions, and
planned outputs; skip Steps 2.2–2.3 and continue at the first incomplete write. Only a safe-to-
re-plan run may repeat those read-only steps, and only because no write has occurred.

### 2.1 Read the tracker note end-to-end

You need every field, but especially:

- `search_strategy` (web / rss / github_releases / arxiv / manual_prompt)
- `queries:` (the search inputs)
- `sources_to_revisit:` (URLs/feeds to always re-check)
- `freshness_window_days` (how far back items count as "new")
- `reliability_floor` (drop items below this score)
- `update_targets:` (which wiki pages this tracker can update)
- `auto_update_wiki:` (true → edit directly; false → propose via needs-review task)
- `human_review_required:` (true → finishing status is `needs_review`, never `done`)
- `forbidden_actions:` (read these literally; they're hard nos)
- The body `# Search recipe` and `# What "material change" means` sections

### 2.2 Execute the search strategy

| `search_strategy` | What to do |
| --- | --- |
| `web` | Run each query via the allowed search tool (typically WebSearch). Revisit every URL in `sources_to_revisit:`. Filter to items dated within `freshness_window_days`. Prefer `domains_to_prefer:`, exclude `domains_to_exclude:`. |
| `rss` | Poll each feed in `sources_to_revisit:` (use WebFetch if no dedicated RSS tool). Filter by `freshness_window_days`. |
| `github_releases` | For each repo in `sources_to_revisit:`, fetch the recent releases. |
| `arxiv` | Query arXiv for the listed authors/keywords. |
| `manual_prompt` | Present the queries to the user; wait for a reply. This is the path for `sensitivity: sensitive` trackers — no autonomous web search. |

### 2.3 Score results against material-change criteria

Read the tracker's `# What "material change" means` section. For each candidate item:

- Assign a reliability score (use the rubric in the tracker, or `_workflows/run-tracker.md`'s default if absent).
- Drop items below `reliability_floor` — they go in the digest's `# What needs review`, not `# What's material`.
- Flag items that clearly meet the material-change criteria for the `# What's material` section.

Don't over-include. A "material change" is meant to be rare; a digest with everything marked material is a tracker that's tuned wrong, not a great week.

### 2.4 Create or resume the partial digest

Path: `Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md`. Before creating Source notes,
editing wiki pages, creating Tasks/followups, or changing tracker/history/log state, create this
write-ahead record with `status: partial` and `plan_status: building`. On recovery, reuse it without
erasing completed actions. Conform to `_schemas/tracker_digest.md` exactly and record
`pre_run_miss_count`, `pre_run_next_check`, `planned_miss_count`, `planned_next_check`, and a
`planned_outputs` descriptor for every Source/wiki/Task/followup,
tracker-field bundle, History bullet, and log line. Each descriptor includes its kind, stable target,
and exact expected content, field values, or child-workflow completion identity. Order descriptors
by execution: direct outputs, tracker fields, History, then log. Initialize every progress mirror
(`verified_outputs`, the output arrays, and `# What I changed`) empty. Required body sections:

- `# What I looked at` — the queries / sources / feeds polled, plus a count.
- `# What's new` — every item that passed the freshness filter (even if not material).
- `# What's material` — the subset that meets the material-change criteria. **One bullet per item with the planned wikilink to a Source note and one sentence of "why this is material."** During `plan_status: building`, record that Source's expected canonical raw and Source-note paths. Create or verify it via `/ingest-source` in Step 2.5 after the plan is complete.
- `# What I changed` — starts empty; add each update only after its target verifies in Step 2.5.
- `# What needs review` — items that the user should look at: items below `reliability_floor`, items the tracker isn't sure how to classify, sources that have disappeared.
- `# Next-run recommendations` — anything you want the next run to do differently (broaden queries, drop a stale source, raise the reliability floor).

The digest is the audit trail. Even if nothing was material this week, write the digest with all
sections—that's what proves the tracker ran. After every section, bookkeeping value, and planned
output is recorded, set `plan_status: complete` as the final planning write before Step 2.5. Never
infer this transition from whether sections happen to be empty. Keep `status: partial` through
Steps 2.5–2.8; only Step 2.9 may set it to `complete`.

After `plan_status: complete`, the discovery results, materiality decisions, pre-run/planned
bookkeeping, and `planned_outputs` are immutable. Process planned descriptors in list order.
`verified_outputs` is an append-only ordered prefix of `planned_outputs`: after a target verifies,
append its identical descriptor if it is not already present. The body `# What I changed` section
and `wiki_pages_updated`, `tasks_created`, `followups_created`, and `sources_added` arrays are
progress mirrors; never use them to infer or extend the plan. Stop for manual integrity review if
`verified_outputs` contains a duplicate, an unplanned descriptor, or a non-prefix ordering.

### 2.5 Apply or propose `update_targets`

For each entry in `update_targets:`:

- If `auto_update_wiki: true` — edit the target page directly. Be conservative: usually that means appending one line to an `# Open loops` or `# Recent activity` section, not rewriting prose.
- If `auto_update_wiki: false` — write a needs-review Task: `[[Apply <tracker> digest update to <target>]]`, body explains the proposed edit. Don't touch the target page.

Before each direct side effect, consult the partial digest and the target. Verify an existing exact
wiki append, Task, or followup instead of repeating it; otherwise apply it once, then immediately
verify the target. Update the digest's `# What I changed` section and matching output array, then
append the identical planned descriptor to `verified_outputs` if absent as the last per-output
digest write.

A planned Source note is a separate multi-step child transaction, so **Source-note existence alone
is not completion**. Before invoking `/ingest-source`, require the completed plan to already record
its expected canonical raw and Source-note paths; never extend the plan after `plan_status:
complete`. Treat the child as complete only when the Source
note is fully populated, its listed wiki / Task / index outputs exist, and `log.md` contains the
matching final `agent:librarian` ingest line.

If none of the child artifacts exists, invoke `/ingest-source` normally. If any raw file, Source
note, or downstream output exists but the final completion evidence is missing, **do not consume
the raw file or auto-resume the child workflow**: its acquisition integrity is outside the tracker
transaction. Leave the tracker digest `partial` (or mark it `failed` with the reason) and surface
manual source-ingest recovery. After the child is repaired separately, a tracker retry may verify
the complete evidence, update `sources_added` and `# What I changed`, append the unchanged planned
descriptor to `verified_outputs` last, and continue.
Never create a parallel Source note.

### 2.6 Update the tracker frontmatter

Edit the tracker note:

- If discovery recorded a dead/404 source, use the broken-source branch in Step 5 instead of the
  normal cadence/miss-count updates below.
- `last_checked: <today>`
- `next_check: <today + cadence>` — use the cadence arithmetic table in `_workflows/run-tracker.md` (weekly = +7d, biweekly = +14d, monthly = +1mo, etc.).
- `last_digest: "[[Tracker Digest - <slug> - <today>]]"`
- `miss_count: 0` if material findings, else the pre-run `miss_count + 1` recorded in the partial
  digest. On recovery, set that deterministic result; never increment the already-updated value.
- If `miss_count >= 5` after the update, `status: needs_review` — let the auditor and the user decide whether to retune or retire.
- `updated: <today>`

After all planned tracker fields verify, append the identical tracker-field descriptor to
`verified_outputs` if absent.

### 2.7 Append to the tracker's `# History`

**Do not skip this: `last_digest` is state; `# History` is provenance.** The frontmatter identifies the latest run, while the history indexes every run and is required by `_schemas/tracker.md`.

Append one bullet at the end of `# History`, linking to the digest:

```
- <today> — <First run|Nth run|Run>. material=<true|false>, <items_found> items (<items_material> material). <one-sentence headline, or "nothing material">. <what was applied or proposed>. → [[Tracker Digest - <slug> - <today>]].
```

Rules:

- **One line per run, always — including `material: false` runs.** A no-material run is still an observation and makes a climbing `miss_count` understandable. Without the bullet, "nothing material" is indistinguishable from "never ran."
- On recovery, first check for this digest link in `# History`; verify an existing bullet instead
  of appending a duplicate.
- State what happened to `update_targets`: name the page updated when `auto_update_wiki: true`; when false, name the needs-review Task created for the proposed edit.
- Keep it to one line. The digest holds the detail; `# History` is only the index.

After the exact planned bullet verifies, append its identical descriptor to `verified_outputs` if
absent.

### 2.8 Per-tracker log line

Append one line to `log.md`:

```
<datetime-with-tz> — agent:tracker — brief — [[<Subject>]] — material=<true|false> items=<N>; [[Tracker Digest - <slug> - <today>]] created<; updated [[<target>]] (if any)>.
```

On recovery, first check for a matching `agent:tracker` line containing this digest link and do
not append it twice. After the exact planned line verifies, append its identical descriptor to
`verified_outputs` if absent.

### 2.9 Finalize the digest

Verify `verified_outputs` exactly equals `planned_outputs` in the same order, every target, the tracker frontmatter,
the digest-linked `# History` bullet, and the matching `log.md` line. Only after all are present,
set the digest to `status: complete` as
the final write. If any item cannot be verified, leave the digest `partial` (or mark it `failed`
with the reason). A later invocation may resume only from a complete authoritative plan; the
missing-plan and child-workflow boundaries above remain fail-closed. A completed digest is
immutable; handle missing external evidence as drifted-complete manual review, never auto-repair.

## Step 3 — Honor `forbidden_actions`

Read each tracker's `forbidden_actions:` literally. Common entries:

- "Do not directly edit the source page" — propose, don't touch.
- "Do not surface sensitive items in the public digest" — drop or summarize at a higher level.
- "Do not run more than once per cadence period" — re-check `last_checked` if a re-run is requested.

If a `forbidden_actions:` item conflicts with what the user is asking for, stop and ask — don't override.

## Step 4 — Sensitivity guard

Per the standing rule (also in the paste prompt's "Notes"):

- `sensitivity: sensitive` trackers must use `search_strategy: manual_prompt` or a vetted MCP tool only. Never raw external web search. If a sensitive tracker is in the run set and its `search_strategy` is `web`, stop and surface the configuration mismatch.

## Step 5 — Broken-source guard

If any URL in `sources_to_revisit:` returns 404 or a feed is dead:

- During discovery, record the failure without mutating the tracker. Create the partial digest
  first and add the broken source to `# What needs review`.
- While building the plan, set `planned_next_check` to `pre_run_next_check`, set
  `planned_miss_count` to `pre_run_miss_count`, and make the tracker-field descriptor specify the
  broken-state fields below.
- In Step 2.6, set `status: broken`, `last_checked: <today>`, `last_digest`, and `updated: <today>`.
  `broken` takes precedence over the `miss_count >= 5` / `needs_review` transition. Preserve the pre-run
  `next_check` and `miss_count`: an incomplete search is neither a cadence advance nor a valid
  no-material observation.
- Surface in the next morning's daily briefing (the briefing's section 8 reads `status: broken` trackers).

## Step 6 — Wrap-up

Compact report:

```
Trackers run: <N>
- Material findings: <N>  (most consequential: [[Tracker Digest - X]] — <one-line>)
- No material change: <N>
- Broken / needs_review surfaced: <N>

Next due: <date> for <tracker>.
```

Don't recapitulate every digest in chat — the digests are the artifacts.

## What this skill does NOT do

- **Does not mark itself `done`.** `human_review_required: true` trackers leave open the question of whether the digest update is enough; the user is the closer. The skill's natural finishing state is "digest written, tracker bookkeeping updated, log line appended" — not `status: done` on the tracker.
- **Does not edit `Raw/`.** Raw is immutable; the digest is the right place for raw paste-ins if needed.
- **Does not silently widen `forbidden_actions:`.** If a tracker's restrictions feel wrong, surface the mismatch — the user updates the tracker, the skill doesn't.
- **Does not run off-cadence without note.** A force-run is logged in the digest's `# What I looked at` so the audit trail is honest about cadence drift. Force never permits overwriting a same-day digest.

## Model recommendation

`opus` for the orchestration (especially the "is this material?" judgment); `sonnet` or `haiku` is fine for the per-query web-search step which is mechanical fetching. For a single tracker that just needs `manual_prompt` answered, inherited is fine — the cost is in user back-and-forth, not model.

## Related

- `Agents/Prompts/run-trackers.md` — paste-able prompt equivalent.
- `_workflows/run-tracker.md` — the canonical procedure.
- `_schemas/tracker.md`, `_schemas/tracker_digest.md` — the schemas.
- `daily-briefing` — reads fresh material digests and surfaces them in section 8.
- `session-start` — surfaces stale trackers and recommends invoking this skill.
- `log-mutation` — the canonical log-append helper.
