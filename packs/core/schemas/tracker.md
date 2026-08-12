# Schema: tracker

A **Tracker** is a standing instruction to keep a wiki page (or set of pages) fresh on a chosen cadence. Trackers are the vault's antidote to stale knowledge.

File path: `Atlas/Trackers/<Subject>.md` — run the subject through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: tracker
id: tracker-<slug>
status: active            # active | paused | archived | broken | needs_review (set by run-trackers at miss_count >= 5)
subject: "<short subject phrase>"
# What to keep fresh — at least one of:
watches:
  - "[[<Name>]]"
  - "[[<Name>]]"
  - "[[<Name>]]"
  - "[[<Name>]]"
  - "[[<Name>]]"
# How often to re-check
cadence: weekly           # daily | weekly | biweekly | monthly | quarterly | event-driven | adhoc
last_checked: YYYY-MM-DD
next_check: YYYY-MM-DD
# How to look
search_strategy: web      # web | rss | github_releases | arxiv | newsletter | manual_prompt | mcp_tool
queries:                  # plain-text queries for web/arxiv search agents
  - "<query 1>"
sources_to_revisit:       # URLs/feeds/repos to poll
  - "https://..."
domains_to_prefer: []
domains_to_exclude: []
freshness_window_days: 30 # only surface items newer than this on each run
# What to do with hits
update_targets:           # which wiki pages to consider updating
  - "[[<Name>]]"
digest_path: "Atlas/Trackers/Digests/"
notify_in_briefing: true  # if true, the planner agent surfaces new digests in daily briefings
auto_update_wiki: false   # if true, the librarian may edit update_targets without human approval
human_review_required: true
# Quality / governance
reliability_floor: medium # high | medium | low — minimum source reliability to act on
sensitivity: normal
allowed_agents:
  - librarian
  - tracker
forbidden_actions:
  - send_external_email
  - make_purchases
# Lifecycle
created: YYYY-MM-DD
updated: YYYY-MM-DD
last_digest: "[[Tracker Digest - <slug> - YYYY-MM-DD]]"
miss_count: 0             # how many consecutive runs produced nothing material
---
```

## Body sections

- `# Subject` — what we are tracking, in 2–3 sentences
- `# Why this matters` — what decisions or projects depend on staying current
- `# What "material change" means` — explicit criteria for "this is worth a digest entry"
- `# Search recipe` — concrete steps the tracker agent should run (queries, feeds, repos, prompt to ask)
- `# Update rules` — how to revise the linked wiki pages when something material lands
- `# History` — bullet list of dated entries, each linking to a digest

## Cadence semantics

| Cadence | Meaning |
| --- | --- |
| `daily` | High-velocity (e.g. a launch in progress, a court case). Re-check every day. |
| `weekly` | Default for active tech topics (e.g. "Claude Code releases", "Obsidian Bases updates"). |
| `biweekly` | Slower-moving fields. |
| `monthly` | Reference topics that move quarterly but you want a low-noise heartbeat. |
| `quarterly` | Big-arc topics (a research program, a competitor company). |
| `event-driven` | Run only when a specified trigger fires (e.g. "when [[Person]] publishes", "when GitHub repo X tags a release"). |
| `adhoc` | No schedule; run on demand. |

## Rules

- A tracker is **due** when `next_check <= today` and `status == active`.
- At most one digest-producing run is allowed per tracker per calendar date. Inspect the same-day digest, `plan_status`, `planned_outputs`, `verified_outputs`, `last_digest`, `# History`, and `log.md` before normal `status`/`next_check` eligibility filtering. With no same-day artifact or reference, start a fresh run. Log references to the digest that are all exact generic `agent:auto` PostToolUse placeholders are transaction-internal bookkeeping, not downstream writes or completion references, and do not count when classifying recovery. The shipped `log-mutation` hook excludes `Atlas/Trackers/Digests/`; ignore legacy placeholders only when every matching line has the exact generic auto-placeholder format. Any non-placeholder log line or other reference still counts. A same-day run is completed only when its digest has `status: complete` and `plan_status: complete`, `verified_outputs` exactly equals `planned_outputs` in the same order, every target verifies, `last_digest` points to it, `# History` links to it, and `log.md` has the matching digest-linked `agent:tracker` line; do not run again or overwrite the completed digest. Treat a legacy `status: complete` digest with no `plan_status` as completed only when those three references verify; skip it without mutation and surface that outputs cannot be re-verified. Any `status: complete` digest missing required evidence is drifted complete: do not reapply outputs, repair references, rerun discovery, or rewrite it; surface manual integrity review. Any `status: partial` or `failed` digest with `plan_status: complete` is recoverable—even when only the final status transition is missing—regardless of advanced bookkeeping: treat the recorded discovery/plan as authoritative, do not rerun searches, require `verified_outputs` to be an ordered prefix of `planned_outputs`, and resume the first incomplete write. A duplicate, unplanned descriptor, or non-prefix order requires manual integrity review. A partial or failed digest is safe to re-plan only when it has `plan_status: building`, every progress mirror (`verified_outputs`, the output arrays, and `# What I changed`) is empty, and no downstream write/reference; re-run only read-only discovery/scoring, finish that same digest's plan, and set `plan_status: complete` before writes. If an incomplete digest has no `plan_status`; the digest is missing while a same-day write/reference exists; or a `plan_status: building` digest has any nonempty progress mirror, downstream write, or reference, do not reconstruct or mutate; surface manual recovery. A force request bypasses cadence only, not these guards.
- After a run, the tracker agent:
  1. Before any other write, creates or resumes a `tracker_digest` note under `Atlas/Trackers/Digests/` with `status: partial` and `plan_status: building`; records an ordered `planned_outputs` descriptor for every Source/wiki/Task/followup, tracker-field bundle, History bullet, and log line—including every Source's canonical raw and Source-note paths—plus the pre-run/planned `miss_count` and `next_check`, and initializes every progress mirror (`verified_outputs`, the output arrays, and `# What I changed`) empty. It then sets `plan_status: complete` as the final planning write before side effects. The discovery/materiality snapshot, bookkeeping, and `planned_outputs` are immutable afterward.
  2. Processes planned Source/wiki/Task/followup descriptors in order. It verifies an exact existing output before repeating it or applies it once, verifies the target, updates `# What I changed` and the matching output array, then appends the identical descriptor to `verified_outputs` as the last per-output digest write. `verified_outputs` is an append-only ordered prefix of `planned_outputs`. A Source note delegates to a separate multi-step source-ingest transaction, so Source-note existence alone is not completion: require the expected canonical raw and Source-note paths to already exist in the completed plan and never extend the plan here, then require the fully populated Source note, its listed wiki / Task / index outputs, and matching final `agent:librarian` line in `log.md`. If any child artifact exists without that final evidence, do not consume its raw file or auto-resume it; leave the tracker digest `partial` (or `failed` with the reason) and surface manual source-ingest recovery. Continue only after the child is repaired separately and its complete evidence verifies.
  3. Updates `last_checked`, `next_check` (computed from `cadence`), `last_digest:`, and the deterministic post-run `miss_count` on the tracker; after the complete field bundle verifies, it appends the identical descriptor to `verified_outputs`. Compute `miss_count` from the pre-run value recorded in the partial digest; on recovery, reuse that result instead of incrementing the current value again. If discovery recorded a dead/404 source, the completed plan sets `planned_next_check` equal to `pre_run_next_check` and `planned_miss_count` equal to `pre_run_miss_count`, and uses the broken branch instead: after the partial digest exists, set `status: broken`, `last_checked`, `last_digest`, and `updated`, preserve `next_check` and `miss_count`, and do not apply the `needs_review` transition.
  4. Appends one bullet to `# History` linking to the digest. `last_digest` is state; `# History` is provenance. Write one line per run, including `material: false` runs, verify rather than duplicate it on recovery, then append the identical descriptor to `verified_outputs`.
  5. Appends the planned line to `log.md`, or verifies the exact digest-linked line already exists on recovery, then appends the identical descriptor to `verified_outputs`.
  6. After verifying `verified_outputs` exactly equals `planned_outputs` in the same order, every target, and every reference, including the matching `log.md` line, sets the digest to `status: complete` as the final write. Until then it remains `partial` (or `failed` with a reason).
  7. If `notify_in_briefing: true`, the planner picks up the digest in the next daily briefing only
     after the digest has `status: complete`; `partial` and `failed` digests are never surfaced.
- If a tracker produces no material change `miss_count >= 5` consecutive runs, the auditor proposes lengthening the cadence.
- Trackers with `status: broken` (e.g. URL 404, feed dead) surface in the daily briefing for repair.
- `sensitivity: sensitive` trackers must use only `search_strategy: manual_prompt` or vetted MCP tools — never raw external web search.

## Examples of good tracker subjects

- "Latest stable Obsidian Bases features" — weekly
- "Claude Code release notes" — weekly
- "Example LLM wiki gist revisions" — monthly (event-driven on revision)
- "New papers citing Example 2026 LLM-OS gist" — biweekly
- "[[Anthropic]] product announcements" — weekly
- "[[Alex Kim]] public writing" — monthly
- "FDA guidance on `<therapeutic area>`" — monthly
- "Conference deadlines: NeurIPS, ICML, ICLR" — quarterly
