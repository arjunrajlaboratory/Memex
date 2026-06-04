---
type: tracker
id: tracker-{{slug}}
status: active            # active | paused | archived | broken
subject: ""
# What to keep fresh — at least one of:
watches: []
# How often to re-check
cadence: weekly           # daily | weekly | biweekly | monthly | quarterly | event-driven | adhoc
last_checked: {{date}}
next_check:
# How to look
search_strategy: web      # web | rss | github_releases | arxiv | newsletter | manual_prompt | mcp_tool
queries: []
sources_to_revisit: []
domains_to_prefer: []
domains_to_exclude: []
freshness_window_days: 30 # only surface items newer than this on each run
# What to do with hits
update_targets: []
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
created: {{date}}
updated: {{date}}
last_digest:
miss_count: 0             # how many consecutive runs produced nothing material
---

# Subject

# Why this matters

# What "material change" means

# Search recipe

# Update rules

# History
