# Workflow: run tracker

**Role:** `agent:tracker`
**Trigger:** any tracker with `status: active` and `next_check <= today`; or explicit user request to run a named tracker
**Output:** one `Tracker Digest - <slug> - <today>.md` per tracker run; updates to the tracker note; possibly updates to `update_targets`

## Steps for a single tracker

1. Read the tracker note end-to-end. Note its `search_strategy`, `queries`, `sources_to_revisit`, `freshness_window_days`, `reliability_floor`, `update_targets`, `auto_update_wiki`, `human_review_required`, `allowed_agents`, `forbidden_actions`. Resolve today's expected digest and inspect it, every planned output recorded in it, `last_digest`, `# History`, and `log.md` before `status`/`next_check` filtering. Log references to the digest that are all exact generic `agent:auto` PostToolUse placeholders are transaction-internal bookkeeping, not downstream writes or completion references, and do not count when classifying recovery. The shipped `log-mutation` hook excludes `Atlas/Trackers/Digests/`; ignore legacy placeholders only when every matching line has the exact generic auto-placeholder format. Any non-placeholder log line or other reference still counts. Classify the run:
   - Completed only when the digest has `status: complete` and `plan_status: complete`, `verified_outputs` exactly equals `planned_outputs` in the same order, every target verifies, `last_digest` points to it, `# History` links to it, and `log.md` has the matching digest-linked `agent:tracker` line. Then stop and report "already ran today." Force does not bypass this guard.
   - Legacy completed when `status: complete`, `plan_status` is absent, and `last_digest`, `# History`, and the digest-linked `agent:tracker` log line verify. Skip without mutation, report the legacy evidence, and surface that outputs cannot be re-verified; never upgrade or overwrite it.
   - Drifted complete when any `status: complete` digest is missing required output/reference evidence. Do not reapply outputs, repair references, rerun discovery, or rewrite the digest; surface manual integrity review.
   - Recoverable whenever a `status: partial` or `failed` digest has `plan_status: complete`, including when only the final status transition is missing. Treat that snapshot as authoritative: do not rerun searches or change the plan; require `verified_outputs` to be an ordered prefix of `planned_outputs`, then resume at the first incomplete write using the same path. A duplicate, unplanned descriptor, or non-prefix ordering requires manual integrity review. Include this work before normal eligibility filtering even if bookkeeping already advanced.
   - Safe to re-plan when a partial or failed digest has `plan_status: building`, all progress mirrors (`verified_outputs`, the output arrays, and `# What I changed`) are empty, and no downstream write or completion reference exists. Re-run only read-only discovery/scoring, finish the plan in that same digest, set `plan_status: complete`, and continue before normal eligibility filtering.
   - Blocked when an incomplete digest has no `plan_status`; the digest is missing while a same-day write/reference exists; or a `plan_status: building` digest has any nonempty progress field, downstream write, or reference. Do not rerun discovery, create a digest, or mutate anything; surface manual recovery with the conflicting evidence.
   - Fresh only when the digest is absent and no same-day artifact/reference exists; apply normal eligibility filtering then.
   Never overwrite a completed digest or create a second same-day digest. A nested child-workflow boundary may also stop recovery as described in Step 7.
2. If `search_strategy: web`, run the queries via the allowed web search tool and revisit any URLs in `sources_to_revisit`. Restrict to `domains_to_prefer` if set; exclude `domains_to_exclude`. Filter to items dated within `freshness_window_days`.
3. If `search_strategy: rss` or `github_releases` or `arxiv`, poll the relevant feeds/APIs from `sources_to_revisit`.
4. If `search_strategy: manual_prompt`, present the queries to the user and wait for a reply.
5. Score each item against the tracker's `# What "material change" means` criteria. Drop items below the threshold.
6. Before any side effect, create or resume `Atlas/Trackers/Digests/Tracker Digest - <tracker-slug> - <today>.md` per `_schemas/tracker_digest.md` with `status: partial` and `plan_status: building`. Populate the findings; record `pre_run_miss_count`, `pre_run_next_check`, `planned_miss_count`, `planned_next_check`, an ordered `planned_outputs` descriptor for every Source/wiki/Task/followup, tracker-field bundle, History bullet, and log line, and initialize all progress mirrors (`verified_outputs`, the output arrays, and `# What I changed`) empty. Order descriptors by execution: direct outputs, tracker fields, History, then log. Each descriptor names a stable target and exact expected content, field values, or child-workflow completion identity; Source descriptors include the canonical raw and Source-note paths. Then set `plan_status: complete` as the final planning write before Step 7. Never infer plan completion from section contents. The discovery results, materiality decisions, bookkeeping, and `planned_outputs` are immutable afterward. Keep `status: partial` until Step 11.
7. Process the direct-output prefix of `planned_outputs` in order. `verified_outputs` is an append-only ordered prefix: for each planned Source/wiki/Task/followup descriptor, inspect the target before acting, verify and reuse an exact existing output rather than repeating it, or apply it once. After the target verifies, update the digest's `# What I changed` section and matching output array, then append the identical descriptor to `verified_outputs` if absent as the last per-output digest write. Never add an unplanned descriptor or use a progress field to infer the plan.
   - If a Source note is warranted, require its canonical raw and Source-note paths to already exist in the completed plan; never extend the plan in this step. Source-note existence alone is not completion: verify a fully populated Source note, its listed wiki / Task / index outputs, and the matching final `agent:librarian` ingest line in `log.md`. With no child artifacts, run source-ingest normally. If any raw file, Source note, or downstream output exists without that final evidence, do not consume the raw file or auto-resume the child workflow; leave the tracker digest `partial` (or `failed` with the reason) and surface manual source-ingest recovery. Continue only after the child is repaired separately and its complete evidence verifies; never create a parallel note.
   - If a wiki update is warranted and `auto_update_wiki: true`, edit the relevant `update_targets`. Otherwise, create a needs-review task that proposes the edit.
8. Update the tracker idempotently, then verify the complete planned field bundle and append its identical descriptor to `verified_outputs` if absent:
   - If discovery recorded a dead/404 source, the completed plan must set `planned_next_check` equal to `pre_run_next_check` and `planned_miss_count` equal to `pre_run_miss_count`, and specify this branch instead of the normal bullets below: set `status: broken`, `last_checked: <today>`, `last_digest`, and `updated: <today>` only after the partial digest exists. Preserve the pre-run `next_check` and `miss_count`; `broken` takes precedence over the normal `miss_count >= 5` / `needs_review` transition.
   - `last_checked: <today>`
   - `next_check: <today + cadence>`
   - `last_digest: [[<digest note>]]`
   - `miss_count: <0 if material else pre-run miss_count + 1>` — record the pre-run value in the partial digest and reuse the computed result on recovery; never increment an already-updated value.
   - If `miss_count >= 5`, set `status: needs_review` (the auditor will propose lengthening cadence).
9. Append one bullet to the tracker's `# History`, linking to the digest. `last_digest` is state; `# History` is provenance. Write one line per run, including `material: false` runs; on recovery, verify an existing bullet with this digest link rather than duplicating it. After the exact planned bullet verifies, append its identical descriptor to `verified_outputs` if absent:
   `- <today> — <First run|Nth run|Run>. material=<bool>, <items_found> items (<items_material> material). <headline, or "nothing material">. <what was applied or proposed>. → [[<digest note>]].`
10. Append to `log.md`; on recovery, verify the exact planned `agent:tracker` line with this digest link rather than duplicating it. After it verifies, append its identical descriptor to `verified_outputs` if absent:
   `<datetime> — agent:tracker — brief — [[<subject>]] — material=<bool> items=<n>; [[<digest note>]] created`
11. Verify the immutable planning snapshot, `verified_outputs` exactly equals `planned_outputs` in the same order, every target, the tracker fields, the digest-linked `# History` bullet, and the matching log line. Only then set the digest to `status: complete` as the final write. If any item cannot be verified, leave it `partial` (or mark it `failed` with the reason). A later invocation may resume only from a complete plan; the missing-plan and child-workflow boundaries above remain fail-closed. A completed digest is immutable; treat missing external evidence as drifted-complete manual review, never auto-repair.

## Cadence arithmetic

| cadence | next_check |
| --- | --- |
| `daily` | today + 1 |
| `weekly` | today + 7 |
| `biweekly` | today + 14 |
| `monthly` | today + 30 |
| `quarterly` | today + 90 |
| `event-driven` | unchanged; surface in the daily briefing under "due — event-driven, awaiting trigger" |
| `adhoc` | unchanged |

## Safety rules

- Honor `forbidden_actions` strictly.
- Do not act on items below `reliability_floor`. Stash them under `# What needs review` with a one-line note.
- `sensitivity: sensitive` trackers may not use external web search; restrict to `manual_prompt` or vetted MCP tools.
- If a `sources_to_revisit` URL 404s or a feed dies, record it during discovery, create the partial digest before any tracker mutation, and use Step 8's broken branch. Surface the broken tracker in the next briefing.
- **Prefer raw-text fetches over rendered pages.** When a URL has both a rendered HTML form and a raw/text endpoint (GitHub Gists `/raw/...`, GitHub blobs `?plain=1`, arXiv `/abs/` vs `/pdf/`, etc.), fetch the raw form. Rendered pages can include comment threads, dynamic content, and engagement widgets that an LLM may summarize lossily or fabricate around.
- **Mark single-source extracted claims as unverified.** If a "fact" (a revision count, a comment count, a number of stars, a quote attributed to the author, a new section heading) appears only in one fetched page and you have no independent corroboration, file it under `# What needs review` with the phrase "single-source, unverified" rather than `# What's material`. Material change requires either (a) the raw source itself showing the change or (b) two or more independent sources agreeing.
