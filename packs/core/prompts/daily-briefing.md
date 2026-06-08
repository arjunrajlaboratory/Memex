# Prompt: daily briefing

**Role:** agent:planner

## Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `{{date}}` | today (YYYY-MM-DD) | Date of the briefing. If `Ops/Briefings/{{date}}.md` already exists, stop and ask the user to confirm before regenerating. |

## When to use

Paste this prompt first thing in the morning, before starting work. Run it once
per day. Do not run it for a date that already has a briefing unless you intend
to regenerate it.

## Prompt

```text
You are `agent:planner`. The date is {{date}}.

Before doing anything else, read these files in full:
- `AGENTS.md`
- `_workflows/daily-briefing.md`
- `_schemas/briefing.md`

Skim the most recent file under `Ops/Briefings/` for structural reference only — do not
copy its content.

**Existence check:** if `Ops/Briefings/{{date}}.md` already exists, stop
immediately and tell the user. Do not overwrite it unless the user explicitly
confirms regeneration.

**Default loop-closing pass:** before gathering the inputs below, read `_config/sources.md`
for enabled streams and `mailboxes.*`. Run `capture-comms` for {{date}}, then
`reconcile-from-comms` in daily-briefing sub-mode, unless {{date}} is more than ~2 days
old. Tier-A reversible bookkeeping auto-applies; Tier-B proposals become `## 0. State
confirmation needed` and are confirmed in one batch after the briefing. The Gmail MCP
searches only `mailboxes.gmail_connected`: sent mail from `mailboxes.forwarding_in` or
`mailboxes.other_sending_accounts` is invisible unless separately connected. For
outbound-contact tasks, an empty connected-mailbox `in:sent` result is inconclusive,
not proof of "not sent"; phrase those items as "couldn't confirm from connected Gmail"
and ask the user.

Gather the following inputs (read only what exists; skip gracefully if absent):
1. Active projects — `Atlas/Projects/*.md` where `status: active`
2. Open tasks — `Ops/Tasks/*.md` where `status` not in [done, canceled]
3. Waiting-for / I-owe items — tasks and commitments flagged as waiting
4. Unprocessed inbox captures — `Inbox/` top level (excluding `_filed/` and `README.md`)
5. Calendar events — `Ops/Calendars/` for today and the next 7 days
6. Agent jobs — `Agents/Jobs/*.md` where `status` in [ready, needs_review]
7. Due trackers — `Atlas/Trackers/*.md` where `status: active` AND `next_check <= {{date}}`
8. Fresh digests — tracker digest notes where `run_at >= {{date}} - 1` AND `material: true`
9. Surfaced followups — `Ops/Followups/*.md` where `surface_on <= {{date}}` AND `status: pending`
10. People needing a touch — `Atlas/People/*.md` where `next_touch <= {{date}}` AND `status: active`

Produce `Ops/Briefings/{{date}}.md` with this exact frontmatter and 13-section body:

---
type: briefing
id: bri-daily-<YYYYMMDD>
scope: daily
date: {{date}}
generated_at: <ISO-8601 timestamp>
generated_by: agent:planner
period_start: {{date}}
period_end: {{date}}
includes_calendar: true
includes_agent_queue: true
includes_comms: <true if the default loop-closing pass ran; false if skipped>
open_tasks_count: <count>
projects_reviewed: <count>
sensitivity: private
---

## 1. Top 3 outcomes for today
## 2. Calendar / time map
## 3. Tasks due or scheduled today
## 4. Waiting on others
## 5. Projects at risk
## 6. New captures needing triage
## 7. Agent opportunities
## 8. Trackers
### Due today
### Fresh digests (material change)
## 9. People
### Follow up today
### I owe
### Upcoming meetings
### Relationship maintenance
## 10. Followups surfaced today
## 11. Decisions needed
## 12. Starter prompts
## 13. End-of-day review prompts

Rules:
- Wiki-link every project, task, person, source, tracker, and digest you mention.
- Never invent deadlines. If due is unknown, write `due: unknown`.
- For each outcome in section 12, write one paste-ready paragraph the user can
  drop into a fresh agent session.
- The People section (9) is mandatory even if all subsections are empty.
- Honor sensitivity: summarize `private` items one level of abstraction higher;
  never quote `sensitive` items unless the user explicitly cited them.
- After saving the file, append exactly one line to `log.md`:
  `<datetime> — agent:planner — briefing — [[Ops/Briefings/{{date}}]] — daily briefing generated`
```

## Notes

- Keep section 1 to three outcomes; fewer is fine, more is not.
- Respect `_schemas/_privacy.md`; briefings default to `sensitivity: private`.
- If a required input folder is missing, note the gap in that section rather than aborting.
