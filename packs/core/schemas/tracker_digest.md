# Schema: tracker_digest

A **Tracker Digest** is the output of one tracker run: what was found, what was material, what changed in the wiki, and what (if anything) needs human review.

File path: `Atlas/Trackers/Digests/Tracker Digest - <tracker-slug> - YYYY-MM-DD.md`

## Frontmatter

```yaml
---
type: tracker_digest
id: digest-<tracker-slug>-YYYYMMDD
tracker: "[[<Subject>]]"
run_at: YYYY-MM-DDTHH:MM:SS-04:00
run_by: agent:tracker
status: partial           # partial while the run is in progress | complete | failed
plan_status: building     # building while the read-only plan is assembled | complete before side effects
pre_run_miss_count: 0
pre_run_next_check: YYYY-MM-DD
planned_miss_count: 0
planned_next_check: YYYY-MM-DD
planned_outputs: []       # ordered, frozen descriptors: kind | target | exact expected result
verified_outputs: []      # append descriptor only after verifying its target
material: true            # true if anything worth surfacing was found
items_found: 0
items_material: 0
wiki_pages_updated: []
tasks_created: []
followups_created: []
sources_added: []         # links to new source notes spawned from this digest
agent_run: "[[YYYYMMDDHHMMSS - tracker-<slug>]]"
sensitivity: normal
---
```

## Body sections

- `# What I looked at` — concrete URLs, feeds, repos, queries
- `# What's new` — bullet list of new findings; each with date, source, one-sentence summary
- `# What's material` — subset that meets the tracker's "material change" criteria
- `# What I changed` — which wiki pages were edited (or proposed for edit)
- `# What needs review` — items the human should look at
- `# Next-run recommendations` — adjust queries, adjust cadence, adjust update targets

## Rules

- At most one tracker run per tracker per calendar date may create a digest. Create this date-keyed digest with `status: partial` and `plan_status: building` before any Source-note, wiki, Task, followup, tracker, History, or log side effect. Record ordered deterministic descriptors in `planned_outputs` for every Source/wiki/Task/followup, tracker-field bundle, History bullet, and log line, plus `pre_run_miss_count`, `pre_run_next_check`, `planned_miss_count`, and `planned_next_check`; initialize every progress mirror (`verified_outputs`, the output arrays, and `# What I changed`) empty. Each descriptor includes `kind`, a stable `target`, and the exact expected content, field values, or child-workflow completion identity. Order descriptors by execution: direct outputs, tracker fields, History, then log. After every required section and descriptor is recorded, set `plan_status: complete` as the final planning write before the first side effect. A retry must never infer plan completion from empty/non-empty sections.
- The discovery results, materiality decisions, pre-run/planned bookkeeping, and `planned_outputs` are immutable after `plan_status: complete`. Process descriptors in order. `verified_outputs` is an append-only ordered prefix of `planned_outputs`: after applying or finding a target, verify it, update `# What I changed` and the matching output array, then append the identical descriptor to `verified_outputs` if absent as the last per-output digest write. Never add an unplanned descriptor, duplicate a descriptor, change a planned descriptor, or accept a non-prefix ordering; surface manual integrity review if that invariant is already broken. The output arrays and `# What I changed` are progress mirrors, not planning evidence.
- A dead/404 source found during discovery is recorded here before tracker mutation. While building the plan, set `planned_next_check` equal to `pre_run_next_check` and `planned_miss_count` equal to `pre_run_miss_count`, and make the tracker-field descriptor specify the broken-state fields. The broken-run branch sets tracker `status: broken`, `last_checked`, `last_digest`, and `updated` only after this partial digest exists; it preserves the pre-run `next_check` and `miss_count`, and `broken` takes precedence over `needs_review`.
- When a planned output delegates to a separate multi-step child workflow such as source-ingest, record the expected canonical raw and Source-note paths while `plan_status: building`; never extend the plan after `plan_status: complete`. The primary note's existence alone is not completion. Require the fully populated Source note, its listed wiki / Task / index outputs, and matching final `agent:librarian` line in `log.md`. If any child artifact exists without that final evidence, do not consume its raw file or auto-resume it; leave this digest `partial` (or `failed` with the reason) and surface manual child-workflow recovery. Continue only after the child is repaired separately and its complete evidence verifies.
- A run is completed only when `plan_status: complete`, `verified_outputs` exactly equals `planned_outputs` in the same order, every target verifies, the tracker `last_digest` points to this digest, `# History` links to it, and `log.md` contains the matching digest-linked `agent:tracker` line. Set `status: complete` only after those checks, as the final write; the digest is then immutable. Do not overwrite a completed digest.
- Downstream consumers such as daily briefing may surface a material digest only when `status: complete`; `material: true` never makes a `partial` or `failed` write-ahead digest eligible.
- A legacy same-day digest with `status: complete` but no `plan_status` is treated as completed only when `last_digest`, `# History`, and its digest-linked `agent:tracker` log line verify. Skip it without mutation, surface that its outputs cannot be re-verified, and never upgrade or overwrite it. Any `status: complete` digest missing required evidence is drifted complete: do not reapply outputs, repair references, rerun discovery, or rewrite it; surface manual integrity review.
- On recovery, any `status: partial` or `failed` digest with a `plan_status: complete` snapshot is recoverable, including when only the final status transition is missing. The snapshot is authoritative: do not rerun searches or change its output plan; require `verified_outputs` to be an ordered prefix of `planned_outputs`, then resume the first incomplete write. A partial or failed `plan_status: building` digest may repeat only read-only discovery/scoring and finish the plan when every progress mirror is empty and no downstream write/reference exists. An incomplete digest with no `plan_status`; a missing digest with any same-day write/reference; or a `plan_status: building` digest with a nonempty progress mirror, downstream write, or reference is ambiguous: do not reconstruct or mutate; surface manual recovery. Force requests bypass cadence only, not these guards.
