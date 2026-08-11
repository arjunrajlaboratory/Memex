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
status: complete          # complete | partial | failed
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

- At most one tracker run per tracker per calendar date may create a digest. The date-keyed digest becomes immutable only when it has `status: complete`, the tracker `last_digest` points to it, and `# History` links to it; do not overwrite the completed digest. If any same-day artifact or reference exists but the digest is `partial` or `failed`, the file is missing, or either tracker reference is missing, resume or repair the existing run and reuse this path. Force requests bypass cadence only, not the completed-run guard.
