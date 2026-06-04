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
- If {{tracker_id}} is set, load only that tracker from Atlas/Trackers/.
- Otherwise, list all files in Atlas/Trackers/ (not Digests/) and select those
  where status: active and next_check <= today.

For each selected tracker, follow _workflows/run-tracker.md exactly:

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

4. Create Atlas/Trackers/Digests/Tracker Digest - <slug> - <today>.md per
   _schemas/tracker_digest.md. Populate all sections:
   # What I looked at, # What's new, # What's material,
   # What I changed, # What needs review, # Next-run recommendations.

5. Apply or propose updates to update_targets:
   - auto_update_wiki: true  → edit update_targets pages directly.
   - auto_update_wiki: false → create a needs-review task proposing the edit.

6. Update the tracker frontmatter:
   - last_checked: <today>
   - next_check: <today + cadence> (per cadence arithmetic table in workflow)
   - last_digest: [[Tracker Digest - <slug> - <today>]]
   - miss_count: 0 if material, else miss_count + 1
   - If miss_count >= 5 after update, set status: needs_review.

7. Append to log.md:
   <datetime> — agent:tracker — <brief> — [[<subject>]] — material=<bool> items=<n>

Honor forbidden_actions strictly throughout.
```

## Notes

- `sensitivity: sensitive` trackers must use `search_strategy: manual_prompt` or a vetted MCP tool only — never raw external web search.
- If any URL in `sources_to_revisit` returns 404 or a feed is dead, set that tracker's `status: broken` and surface it in the next daily briefing.
- Do not mark your own work `done`; set `status: needs_review` and let the user or auditor close it.
