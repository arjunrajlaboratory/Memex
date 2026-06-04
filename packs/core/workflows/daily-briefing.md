# Workflow: daily briefing

**Role:** `agent:planner`
**Trigger:** `Ops/Briefings/<today>.md` does not exist; or explicit user request
**Output:** `Ops/Briefings/<today>.md`

## Default loop-closing pass (Step 1b)

Before gathering the inputs below, run the default multi-source loop-closing pass (the
skill version automates this; pasting the prompt, do it by hand): read `_config/sources.md`
for enabled streams, run `capture-comms` (sent + received email/Slack) then
`reconcile-from-comms` for today. Tier-A reversible bookkeeping auto-applies; Tier-B task
closes (plus passed calendar-event closes if the `calendar` stream is enabled) become the
numbered `## 0. State confirmation needed` section, confirmed in one batch. Skip this pass
for backfilled briefings more than ~2 days old.

## Inputs to read

- `log.md` since the last briefing
- `index.md`
- All active projects (`Atlas/Projects/*.md` with `status: active`)
- All open tasks (`Ops/Tasks/*.md` with `status not in [done, canceled]`)
- All waiting-for / I-owe items (filter tasks + commitments)
- All unprocessed inbox captures
- Calendar events for today and the next 7 days (from `Ops/Calendars/` if present)
- All agent jobs with `status: needs_review` or `ready`
- All due trackers (`status: active` AND `next_check <= today`)
- All recent tracker digests (`run_at >= today - 1`) where `material: true`
- All followups with `surface_on <= today` and `status: pending`
- All people whose `next_touch <= today` and `status: active`

## Prompt template

Use this as the actual prompt for the briefing run.

> You are `agent:planner`. Generate today's briefing at `Ops/Briefings/{{today}}.md` per `_schemas/briefing.md`. Use these rules:
>
> - Top 3 outcomes only. If you can't pick 3, pick fewer.
> - Calendar-aware: respect existing meetings; suggest deep-work blocks in remaining time.
> - For each top task, generate a one-paragraph "starter prompt" the user can paste into a fresh agent session.
> - The People section is mandatory: include "Follow up today", "I owe", "Upcoming meetings", "Relationship maintenance". Honor sensitivity rules — summarize private items at one level of abstraction higher when needed.
> - The Trackers section lists every due tracker and every fresh material digest, with a one-sentence "what's new" per digest.
> - The Agent Opportunities section lists agent-eligible tasks that have all inputs satisfied and are not blocked.
> - Never invent deadlines. If due is unknown, write `due: unknown`.
> - Wiki-link every project, task, person, source, tracker, and digest you mention.
> - Append a line to `log.md` after saving.

## Briefing body skeleton

```markdown
# Daily briefing — {{today}}

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
```
