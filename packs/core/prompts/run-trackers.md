# Prompt: run trackers

**Role:** `agent:tracker`

## Parameters

- `{{tracker_id}}` — (optional) ID of a single tracker to run, e.g. `tracker-example-llm-wiki`. If empty, run all trackers under `Atlas/Trackers/` with `status: active` and `next_check <= today`.

## When to use

Monday mornings for the weekly batch; ad-hoc any time you want a fresh run of one tracker.

## Prompt

```
You are agent:tracker.

Read these files before doing anything else:
- AGENTS.md
- _workflows/run-tracker.md
- _schemas/tracker.md
- _schemas/tracker_digest.md

Determine which trackers to run:
- If {{tracker_id}} is set, load only that tracker from Atlas/Trackers/;
  otherwise list all tracker files (not Digests/) without filtering them yet.
- For every candidate, inspect today's expected digest, its recorded plan and
  outputs, last_digest, # History, and log.md before applying status or
  next_check filters. A run is completed only when status: complete and
  plan_status: complete, verified_outputs exactly equals planned_outputs in the
  same order, every target verifies, both tracker references
  exist, and log.md has the matching digest-linked agent:tracker line; then skip
  it and report "already ran today" (or stop for a named tracker).
- Log references to the digest that are all exact generic agent:auto PostToolUse
  placeholders are transaction-internal bookkeeping, not downstream writes or
  completion references, and do not count when classifying recovery. The shipped
  log-mutation hook excludes Atlas/Trackers/Digests/; ignore legacy placeholders
  only when every matching line has the exact generic auto-placeholder format.
  Any non-placeholder log line or other reference still counts.
- Treat a status: complete legacy digest with no plan_status as completed only
  when last_digest, # History, and its digest-linked agent:tracker log line all
  verify. Skip without mutation, report the legacy evidence, and never upgrade
  or overwrite it.
- If any status: complete digest is missing required output/reference evidence,
  treat it as drifted complete. Do not reapply outputs, repair references, rerun
  discovery, or rewrite it; surface manual integrity review.
- If any status: partial or failed digest has plan_status: complete, add it to
  the recovery set before normal eligibility filtering—even if
  next_check/status bookkeeping already advanced. The
  snapshot is authoritative: do not rerun searches or change its plan. Resume
  its first incomplete write only when verified_outputs is an ordered prefix of
  planned_outputs. A duplicate, unplanned descriptor, or non-prefix ordering
  requires manual integrity review. This includes a run where every target and
  reference verifies but the final status: complete write is missing.
- If a partial or failed digest has plan_status: building, every progress mirror
  (verified_outputs, the output arrays, and # What I changed) is empty, and no
  downstream write/reference exists, re-run
  only read-only discovery/scoring, finish that same digest's
  plan, set plan_status: complete, and process it as recovery work before normal
  eligibility filtering.
- If an incomplete digest has no plan_status; the digest is missing while a
  same-day write/reference exists; or plan_status: building has any nonempty
  progress field, downstream write, or reference, deterministic recovery is
  impossible. Do not rerun discovery, create a digest, or mutate anything;
  surface manual recovery.
- Only after recovery detection, add fresh batch trackers where status: active
  and next_check <= today. A force request may bypass cadence, not the completed
  guard. Do not overwrite a completed digest or create a second same-day digest.

For each selected tracker, follow _workflows/run-tracker.md exactly:

For a recoverable run, skip the discovery/scoring steps below and use the
digest's authoritative snapshot. Repeat those read-only steps only for the
safe-to-re-plan case where no write has occurred.

1. Read the tracker note end-to-end. Note its search_strategy, queries,
   sources_to_revisit, freshness_window_days, reliability_floor,
   update_targets, auto_update_wiki, human_review_required, and
   forbidden_actions.

2. Execute the search_strategy per the tracker's # Search recipe:
   - web: run queries via the allowed search tool; revisit sources_to_revisit
     URLs; filter to items within freshness_window_days; prefer/exclude domains
     per domains_to_prefer / domains_to_exclude.
   - rss / github_releases / arxiv: poll the relevant feeds or APIs.
   - manual_prompt: present queries to the user and wait for a reply.

3. Score each result against the tracker's # What "material change" means.
   Drop items below reliability_floor (stash under # What needs review).

4. Before any Source-note, wiki, Task, followup, tracker, History, or log write,
   create or resume Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md
   per _schemas/tracker_digest.md with status: partial and plan_status: building.
   Record pre_run_miss_count, pre_run_next_check, planned_miss_count,
   planned_next_check, all sections, and an ordered
   planned_outputs descriptor for every Source/wiki/Task/followup, tracker-field
   bundle, History bullet, and log line. Each descriptor names its stable target
   and exact expected content, field values, or child-workflow completion
   identity; Source descriptors include canonical raw and Source-note paths.
   Order descriptors by execution: direct outputs, tracker fields, History, log:
   # What I looked at, # What's new, # What's material,
   # What I changed, # What needs review, # Next-run recommendations.
   Initialize every progress mirror (verified_outputs, the output arrays, and
   # What I changed) empty.
   Set plan_status: complete as the final planning write before Step 5; never
   infer it from section contents. Afterward, keep the discovery/materiality
   snapshot, bookkeeping, and planned_outputs immutable. Process descriptors in
   order; verified_outputs may only be an append-only ordered prefix made of
   identical descriptors.

5. Apply or propose updates to update_targets:
   - for each planned Source note, require its canonical raw and Source-note
     paths to already exist in the completed plan; never extend the plan here.
     Source-note existence alone is not
     completion: verify the fully populated Source note, its listed wiki / Task
     / index outputs, and matching final agent:librarian ingest line in log.md.
     With no child artifacts, run source-ingest normally. If any raw file,
     Source note, or downstream output exists without that final evidence, do
     not consume the raw file or auto-resume the child workflow. Leave the
     tracker digest partial (or failed with the reason) and surface manual
     source-ingest recovery. Continue only after the child is repaired
     separately and its complete evidence verifies; never create a parallel
     note.
   - auto_update_wiki: true  → edit update_targets pages directly.
   - auto_update_wiki: false → create a needs-review task proposing the edit.
   Before each direct output, inspect its target and the partial digest. Verify
   an existing exact append, Task, or followup instead of repeating it;
   otherwise apply it once. After the target verifies, update # What I changed
   and the matching output array, then append the identical descriptor to
   verified_outputs if absent as the last per-output digest write.

6. Update the tracker frontmatter:
   - if discovery recorded a dead/404 source, use the broken branch instead of
     the normal updates below. The completed plan must set planned_next_check
     equal to pre_run_next_check and planned_miss_count equal to
     pre_run_miss_count, and specify: after the
     partial digest exists, set status:
     broken, last_checked, last_digest, and updated; preserve the pre-run
     next_check and miss_count. Broken takes precedence over needs_review.
   - last_checked: <today>
   - next_check: <today + cadence> (per cadence arithmetic table in workflow)
   - last_digest: [[Tracker Digest - <slug> - <today>]]
   - miss_count: 0 if material, else the pre-run miss_count + 1 recorded in the
     partial digest; on recovery, reuse that value instead of incrementing again
   - If miss_count >= 5 after update, set status: needs_review.
   After the complete planned field bundle verifies, append its identical
   descriptor to verified_outputs if absent.

7. Append one bullet to the tracker's # History, linking to the digest.
   last_digest is state; # History is provenance. Write one line per run,
   including material=false runs:
   - <today> — <First run|Nth run|Run>. material=<bool>, <items_found> items
     (<items_material> material). <headline, or "nothing material">.
     <what was applied or proposed>. → [[Tracker Digest - <slug> - <today>]]
   On recovery, verify the existing bullet with this digest link instead of
   appending it twice. After the exact planned bullet verifies, append its
   identical descriptor to verified_outputs if absent.

8. Append to log.md:
   <datetime> — agent:tracker — <brief> — [[<subject>]] — material=<bool> items=<n>; [[Tracker Digest - <slug> - <today>]] created
   On recovery, verify the exact planned agent:tracker line with the digest link
   instead of appending it twice. After it verifies, append its identical
   descriptor to verified_outputs if absent.

9. Verify the immutable planning snapshot, verified_outputs exactly equals
   planned_outputs in the same order, every target, the tracker fields, the
   digest-linked # History bullet, and matching log.md line. Only then set the digest to
   status: complete as the final write. Otherwise leave it partial (or mark it
   failed with the reason). A later invocation may resume only from a complete
   plan; the missing-plan and child-workflow boundaries above remain fail-closed.
   Never rewrite or auto-repair a digest that was already complete; surface
   missing evidence as drifted-complete manual review.

Honor forbidden_actions strictly throughout.
```

## Notes

- `sensitivity: sensitive` trackers must use `search_strategy: manual_prompt` or a vetted MCP tool only — never raw external web search.
- If a URL in `sources_to_revisit` returns 404 or a feed is dead, record the failure during discovery, create the partial digest before changing the tracker, then use the broken branch in Step 6 and surface it in the next daily briefing.
- Do not mark your own work `done`; set `status: needs_review` and let the user or auditor close it.
