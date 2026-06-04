---
name: run-trackers
description: Run all active+due trackers (or one named tracker) per its search_strategy (web/rss/github_releases/arxiv/manual_prompt), score against material-change criteria, write the digest, and apply or propose update_targets per auto_update_wiki. Use whenever the user wants to refresh the vault's living-topic watchers — signaled by phrases like "run the trackers", "run due trackers", "check for tracker updates", "Monday tracker pass", "refresh the ExampleProject releases tracker", "any new digests?", "anything material this week?", or direct invocation "/run-trackers" / "/run-trackers tracker-example-llm-wiki". Without arguments, runs every tracker at `Atlas/Trackers/*.md` where `status: active` and `next_check <= today`; with an explicit tracker id, runs only that one. For each tracker: executes its `search_strategy` (web / rss / github_releases / arxiv / manual_prompt), scores results against the tracker's material-change criteria, drops items below `reliability_floor`, writes `Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md` per `_schemas/tracker_digest.md`, applies or proposes wiki updates per `update_targets` + `auto_update_wiki`, updates the tracker frontmatter (`last_checked`, `next_check`, `last_digest`, `miss_count`), and appends to `log.md`. Honors `forbidden_actions` strictly and respects sensitivity (sensitive trackers must use manual_prompt or vetted MCP only, never raw web search). Use Monday mornings for the weekly batch; auto-trigger from `session-start` when stale trackers exist. Skill is the auto-triggering counterpart to the paste prompt at `Agents/Prompts/run-trackers.md`.
---

# Run due trackers

You are running as **`agent:tracker`** for this skill. Your job: bring every active, due tracker up to date by executing its search recipe, producing a digest, and updating the tracker's bookkeeping fields — without overstepping its `forbidden_actions`.

## Why this skill exists

Trackers are the vault's mechanism for watching topics that change over time without the user having to remember to check. Each tracker has a search recipe, a cadence, a material-change definition, and a contract for what it's allowed to update on its own. The mechanics are non-trivial — `_schemas/tracker.md` has a dozen fields and `_schemas/tracker_digest.md` has six required body sections.

The procedure already lives in canonical form at `_workflows/run-tracker.md`. This skill is the auto-triggering wrapper so a phrase like "run the trackers" or "anything new from the ExampleTracker tracker?" doesn't require pasting the prompt.

The thing that goes wrong without this skill: trackers get stale, miss-counts climb invisibly, and what was supposed to be the vault's signal-on-the-world goes silent. The auditor catches it eventually (`miss_count >= 5` → `status: needs_review`), but a tracker that's been silent for five misses is a tracker that's effectively dead.

## Inputs

- **Tracker id** (optional) — e.g., `tracker-example-llm-wiki` or `[[ExampleProject releases]]`. If omitted, runs all active + due trackers.
- **Force flag** (rare) — if the user says "run the tracker even though it isn't due," honor it but note in the digest's `# What I looked at` that this was an off-cadence run.

## Step 0 — Orient

Read these in full before doing anything:

- `AGENTS.md`.
- `_workflows/run-tracker.md` — the canonical procedure. Re-read every invocation.
- `_schemas/tracker.md` and `_schemas/tracker_digest.md`.

## Step 1 — Determine the run set

If a tracker id was given, load just that tracker.

Otherwise, list all files in `Atlas/Trackers/` (not `Digests/`) and select those where:

- `status: active` AND
- `next_check <= today`

If the set is empty, report "no trackers due — next due <date> for <tracker>" and exit. Don't invent work.

If a tracker has `status: broken`, skip it (the auditor handles broken trackers; running them again won't fix them). If a tracker has `status: needs_review`, skip it and surface in the report — the user needs to decide whether to re-activate or retire.

## Step 2 — For each selected tracker, follow the recipe

Loop over the run set. For each tracker, run these steps in order (this is `_workflows/run-tracker.md` distilled):

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

### 2.4 Write the digest

Path: `Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md`. Conform to `_schemas/tracker_digest.md` exactly. Required body sections:

- `# What I looked at` — the queries / sources / feeds polled, plus a count.
- `# What's new` — every item that passed the freshness filter (even if not material).
- `# What's material` — the subset that meets the material-change criteria. **One bullet per item with a wikilink to a Source note (create the Source if needed via `/ingest-source`) and one sentence of "why this is material."**
- `# What I changed` — every update applied to `update_targets` (filled in by Step 2.5 below).
- `# What needs review` — items that the user should look at: items below `reliability_floor`, items the tracker isn't sure how to classify, sources that have disappeared.
- `# Next-run recommendations` — anything you want the next run to do differently (broaden queries, drop a stale source, raise the reliability floor).

The digest is the audit trail. Even if nothing was material this week, write the digest with all sections — that's what proves the tracker ran.

### 2.5 Apply or propose `update_targets`

For each entry in `update_targets:`:

- If `auto_update_wiki: true` — edit the target page directly. Be conservative: usually that means appending one line to an `# Open loops` or `# Recent activity` section, not rewriting prose.
- If `auto_update_wiki: false` — write a needs-review Task: `[[Apply <tracker> digest update to <target>]]`, body explains the proposed edit. Don't touch the target page.

Record what you did (or what you proposed) in the digest's `# What I changed` section.

### 2.6 Update the tracker frontmatter

Edit the tracker note:

- `last_checked: <today>`
- `next_check: <today + cadence>` — use the cadence arithmetic table in `_workflows/run-tracker.md` (weekly = +7d, biweekly = +14d, monthly = +1mo, etc.).
- `last_digest: "[[Tracker Digest - <slug> - <today>]]"`
- `miss_count: 0` if material findings, else `miss_count + 1`
- If `miss_count >= 5` after the update, `status: needs_review` — let the auditor and the user decide whether to retune or retire.
- `updated: <today>`

### 2.7 Per-tracker log line

Append one line to `log.md`:

```
<datetime-with-tz> — agent:tracker — brief — [[<Subject>]] — material=<true|false> items=<N>; [[Tracker Digest - <slug> - <today>]] created<; updated [[<target>]] (if any)>.
```

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

- Set that tracker's `status: broken` and `last_checked: <today>`.
- Add the broken source to the digest's `# What needs review`.
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
- **Does not run off-cadence without note.** A force-run is logged in the digest's `# What I looked at` so the audit trail is honest about cadence drift.

## Model recommendation

`opus` for the orchestration (especially the "is this material?" judgment); `sonnet` or `haiku` is fine for the per-query web-search step which is mechanical fetching. For a single tracker that just needs `manual_prompt` answered, inherited is fine — the cost is in user back-and-forth, not model.

## Related

- `Agents/Prompts/run-trackers.md` — paste-able prompt equivalent.
- `_workflows/run-tracker.md` — the canonical procedure.
- `_schemas/tracker.md`, `_schemas/tracker_digest.md` — the schemas.
- `daily-briefing` — reads fresh material digests and surfaces them in section 8.
- `session-start` — surfaces stale trackers and recommends invoking this skill.
- `log-mutation` — the canonical log-append helper.
