# Schema: briefing

A **Briefing** is a generated view of current reality at a specific point in time. Daily briefings drive the morning loop; weekly/monthly briefings drive the review loop.

File path:
- Daily: `Ops/Briefings/YYYY-MM-DD.md`
- Weekly: `Ops/Briefings/YYYY-Www.md` (e.g. `2026-W20.md`)
- Monthly: `Ops/Briefings/YYYY-MM.md`

## Frontmatter

```yaml
---
type: briefing
id: bri-<scope>-YYYYMMDD
scope: daily              # daily | weekly | monthly | adhoc
date: YYYY-MM-DD
generated_at: YYYY-MM-DDTHH:MM:SS-04:00
generated_by: agent:planner
period_start: YYYY-MM-DD
period_end: YYYY-MM-DD
includes_calendar: true
includes_agent_queue: true
includes_comms: true      # daily briefing ran the default capture-comms + reconcile loop (Step 1b)
open_tasks_count: 0
projects_reviewed: 0
sensitivity: private      # briefings touch everything; default private
---
```

## Body sections (daily)

- (optional) `## 0. State confirmation needed` — rendered above § 1 only when the default comms loop-closing pass ([[reconcile-from-comms]], via daily-briefing Step 1b) or the stale-state queries surface items whose vault status likely lags reality. Absent on a healthy day. Items are numbered for the batched "yes to 1,3" confirmation.
1. `## 1. Top 3 outcomes for today`
2. `## 2. Calendar / time map`
3. `## 3. Tasks due or scheduled today`
4. `## 4. Waiting on others`
5. `## 5. Projects at risk`
6. `## 6. New captures needing triage`
7. `## 7. Agent opportunities`
8. `## 8. Trackers`
   - `### Due today`
   - `### Fresh digests (material change)`
9. `## 9. People`
   - `### Follow up today`
   - `### I owe`
   - `### Upcoming meetings`
   - `### Relationship maintenance`
10. `## 10. Followups surfaced today`
11. `## 11. Decisions needed`
12. `## 12. Starter prompts`
13. `## 13. End-of-day review prompts`

## Rules

- Briefings are saved to disk, not left in chat history.
- Every task, project, and person mentioned must be wiki-linked.
- Never invent deadlines. If due is unknown, say so.
- Prefer fewer top priorities (3, not 10).
- The planner agent appends to `log.md` after generating a briefing.
