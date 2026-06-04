# Workflow: run tracker

**Role:** `agent:tracker`
**Trigger:** any tracker with `status: active` and `next_check <= today`; or explicit user request to run a named tracker
**Output:** one `Tracker Digest - <slug> - <today>.md` per tracker run; updates to the tracker note; possibly updates to `update_targets`

## Steps for a single tracker

1. Read the tracker note end-to-end. Note its `search_strategy`, `queries`, `sources_to_revisit`, `freshness_window_days`, `reliability_floor`, `update_targets`, `auto_update_wiki`, `human_review_required`, `allowed_agents`, `forbidden_actions`.
2. If `search_strategy: web`, run the queries via the allowed web search tool and revisit any URLs in `sources_to_revisit`. Restrict to `domains_to_prefer` if set; exclude `domains_to_exclude`. Filter to items dated within `freshness_window_days`.
3. If `search_strategy: rss` or `github_releases` or `arxiv`, poll the relevant feeds/APIs from `sources_to_revisit`.
4. If `search_strategy: manual_prompt`, present the queries to the user and wait for a reply.
5. Score each item against the tracker's `# What "material change" means` criteria. Drop items below the threshold.
6. For each material item, decide: does it warrant a new `source` note? a wiki page update? a new task? a followup?
   - If a source note is warranted, run the source-ingest workflow for it.
   - If a wiki update is warranted and `auto_update_wiki: true`, edit the relevant `update_targets`. Otherwise, create a needs-review task that proposes the edit.
7. Create `Atlas/Trackers/Digests/Tracker Digest - <tracker-slug> - <today>.md` per `_schemas/tracker_digest.md`. Populate `# What I looked at`, `# What's new`, `# What's material`, `# What I changed`, `# What needs review`.
8. Update the tracker:
   - `last_checked: <today>`
   - `next_check: <today + cadence>`
   - `last_digest: [[<digest note>]]`
   - `miss_count: <0 if material else miss_count + 1>`
   - If `miss_count >= 5`, set `status: needs_review` (the auditor will propose lengthening cadence).
9. Append to `log.md`:
   `<datetime> — agent:tracker — brief — [[<subject>]] — material=<bool> items=<n>`

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
- If a `sources_to_revisit` URL 404s or a feed dies, set the tracker `status: broken` and surface in the next briefing.
- **Prefer raw-text fetches over rendered pages.** When a URL has both a rendered HTML form and a raw/text endpoint (GitHub Gists `/raw/...`, GitHub blobs `?plain=1`, arXiv `/abs/` vs `/pdf/`, etc.), fetch the raw form. Rendered pages can include comment threads, dynamic content, and engagement widgets that an LLM may summarize lossily or fabricate around.
- **Mark single-source extracted claims as unverified.** If a "fact" (a revision count, a comment count, a number of stars, a quote attributed to the author, a new section heading) appears only in one fetched page and you have no independent corroboration, file it under `# What needs review` with the phrase "single-source, unverified" rather than `# What's material`. Material change requires either (a) the raw source itself showing the change or (b) two or more independent sources agreeing.
