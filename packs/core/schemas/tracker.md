# Schema: tracker

A **Tracker** is a standing instruction to keep a wiki page (or set of pages) fresh on a chosen cadence. Trackers are the vault's antidote to stale knowledge.

File path: `Atlas/Trackers/<Subject>.md` — run the subject through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: tracker
id: tracker-<slug>
status: active            # active | paused | archived | broken
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
- After a run, the tracker agent:
  1. Creates a `tracker_digest` note under `Atlas/Trackers/Digests/`.
  2. Updates `last_checked`, `next_check` (computed from `cadence`), and `last_digest:` on the tracker.
  3. If `auto_update_wiki: true`, edits each `update_targets` page; otherwise creates a needs-review task to do so.
  4. Appends a line to `log.md`.
  5. If `notify_in_briefing: true`, the planner picks up the digest in the next daily briefing.
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
