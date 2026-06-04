---
name: daily-briefing
description: Generate today's 13-section operating-dashboard briefing for the vault (Top 3 outcomes through End-of-day prompts), open it in the browser, and refuse silent overwrites. Use whenever the user wants today's operating dashboard generated — signaled by phrases like "generate the daily briefing", "today's briefing", "what's the briefing for today", "make today's briefing", "give me the morning briefing", "what's on for today (full version)", or direct invocation "/daily-briefing" / "/daily-briefing 2026-05-19". Synthesizes the vault's current state into `Ops/Briefings/<YYYY-MM-DD>.md` per `_schemas/briefing.md` and the full procedure in `_workflows/daily-briefing.md` — reads active projects, open tasks, waiting-for items, unprocessed inbox, calendar for today + next 7 days, agent jobs, due trackers and fresh digests, surfaced followups, people needing a touch — and produces the 13-section briefing body (Top 3 outcomes, Calendar / time map, Tasks due today, Waiting on others, Projects at risk, New captures needing triage, Agent opportunities, Trackers, People, Followups surfaced today, Decisions needed, Starter prompts, End-of-day review prompts). Refuses to overwrite an existing briefing without explicit confirmation. Use first thing in the morning before starting work, once per day; this skill is the auto-triggering counterpart to the paste prompt at `Agents/Prompts/daily-briefing.md`.
---

# Generate today's daily briefing

You are running as **`agent:planner`** for this skill. The user wants today's operating dashboard — a synthesis of every open loop in the vault rendered as a 13-section briefing they can use to decide where to spend the day.

## Why this skill exists

The briefing is the single highest-leverage daily artifact this vault produces. It's the difference between starting the day with "what should I work on?" (fragmented context, scrolling through Tasks, missing the calendar) versus starting with "here are my three outcomes, the four things blocking me, and the one tracker that needs a look." But it's also the most context-heavy synthesis — touching every primary folder of the vault — so the procedure must be exact.

The procedure already lives, in canonical form, in two places: `_workflows/daily-briefing.md` (the workflow doc) and `_schemas/briefing.md` (the schema). The paste-able prompt `Agents/Prompts/daily-briefing.md` wraps both. This skill is the auto-triggering version so a phrase like "generate today's briefing" doesn't require pasting.

## Inputs

- **Date** (optional, default today) — `YYYY-MM-DD`. The user can request a backfilled briefing for a specific date.
- **Force flag** (rare) — if the user says "regenerate today's briefing," they're overriding the existence check.

## Step 0 — Orient

Read these in full before doing anything:

- `AGENTS.md` — for actor and contract reminders.
- `_workflows/daily-briefing.md` — the canonical procedure. Re-read every invocation.
- `_schemas/briefing.md` — the schema.

Skim the most recent prior briefing under `Ops/Briefings/` for structural reference only — do NOT copy its content.

## Step 1 — Existence check

If `Ops/Briefings/<date>.md` already exists, **stop**. Tell the user:

> A briefing for <date> already exists at `Ops/Briefings/<date>.md`. Want me to regenerate it (the existing one will be overwritten)?

Wait for explicit confirmation. The standing rule is one briefing per day; regenerating is the exception, and silent overwrites destroy the morning's earlier read.

If today's briefing already has a `## Shutdown notes` section appended (from `shutdown-review`), **never** silently overwrite — that's irreplaceable end-of-day content.

## Step 2 — Gather inputs (in parallel)

Run these reads in parallel — one message, multiple tool calls. Read only what exists; skip gracefully if a folder is absent.

1. **Active projects** — `Atlas/Projects/*.md` where `status: active`.
2. **Open tasks** — `Ops/Tasks/*.md` where `status` not in `[done, canceled]`.
3. **Waiting-for / I-owe items** — tasks and commitments flagged as `waiting`.
4. **Unprocessed inbox captures** — `Inbox/` top level (excluding `_filed/` and `README.md`).
5. **Calendar events** — `Ops/Calendars/` for today + the next 7 days. (If a Google Calendar MCP read is available and recently authorized, pull from there too — but the vault copy is the source of truth.)
6. **Agent jobs** — `Agents/Jobs/*.md` where `status` in `[ready, needs_review]`.
7. **Due trackers** — `Atlas/Trackers/*.md` where `status: active` AND `next_check <= <date>`.
8. **Fresh digests** — tracker digest notes where `run_at >= <date> - 1` AND `material: true`.
9. **Surfaced followups** — `Ops/Followups/*.md` where `surface_on <= <date>` AND `status: pending`.
10. **People needing a touch** — `Atlas/People/*.md` where `next_touch <= <date>` AND `status: active`.

Also pull yesterday's briefing's "## Shutdown notes" section if present — it carries the user's last signal about energy, surprises, and unresolved questions, which directly informs today's Top 3 outcomes.

## Step 2b — Stale-state pre-flight (catch silent close-loop gaps)

Before § 1, scan for vault items where state likely lags reality. The user does work off-vault (sends emails, uploads to portals, runs lints) without invoking the close-out skill, so notes silently rot at the previous status. The briefing is the natural daily checkpoint to surface these.

Four pre-flight queries (run in parallel):

1. **Letters still `drafting` near deadline** — `Atlas/Letters/*.md` where `status: drafting` AND `due <= <date> + 7`. Most common gap (user submits by email or portal upload, never edits the Letter note).
2. **Tasks `needs_review` past due by >3 days** — `Ops/Tasks/*.md` where `status: needs_review` AND `due <= <date> - 3`. Usually represents work the user actually finished but didn't close.
3. **Tasks `in_progress` with stale work log** — `Ops/Tasks/*.md` where `status: in_progress` AND last `# Work log` entry older than 5 days. Either drift (should close) or genuine in-flight work (legitimate).
4. **Scheduled tasks whose block has passed** — `Ops/Tasks/*.md` where `status: scheduled` AND `scheduled_end < now`. The single most common lag case: a time-blocked task came and went without being closed *or* rescheduled. Surfacing these is how the next morning's briefing catches "I had a full day and four blocks slipped." Multiple scheduled blocks can silently carry because the original three queries didn't cover scheduled-but-not-closed; this query is the fix.

For each hit, render a line in a new **`## 0. State confirmation needed`** section at the very top of the briefing (above § 1) — exactly this format:

```markdown
## 0. State confirmation needed

The vault thinks the following are still in progress. Were any of them already done?

- [[<Letter or Task wikilink>]] — `status: <current>` (due <date>). If submitted/done: edit the note's `status:` + `submitted:`/Work log, then this lifts.
- ...

Reply yes/no/partial in chat and the planner will close the loop.
```

If no items hit any of the four queries, omit this section entirely. The signal of a healthy vault is that § 0 is absent.

**In the chat report-back (Step 6),** also surface this list above the Top 3 — see Step 6.

## Step 3 — Write the briefing

Path: `Ops/Briefings/<date>.md`. Conform to `_schemas/briefing.md` exactly.

Frontmatter (the full block — fill every field):

```yaml
---
type: briefing
id: bri-daily-<YYYYMMDD>
scope: daily
date: <date>
generated_at: <ISO-8601 timestamp>
generated_by: agent:planner
period_start: <date>
period_end: <date>
includes_calendar: true
includes_agent_queue: true
open_tasks_count: <count>
projects_reviewed: <count>
sensitivity: private
---
```

Body — the 13 sections, in this exact order with this exact heading text:

```
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

### Per-section rules

- **Section 1 — Top 3 outcomes:** at most three. Fewer is fine; more is not. Pick from open Tasks scheduled today + projects-at-risk + people-needing-a-touch. Lead with the highest-leverage outcome, not the easiest.
- **Section 2 — Calendar / time map:** chronological. Include the time, the event, and one line of "what to come prepared with" where applicable.
- **Section 3 — Tasks due or scheduled today:** wikilinks only, with effort and priority. If a Task has `scheduled_start`/`scheduled_end`, render those too.
- **Section 5 — Projects at risk:** a project is "at risk" if its `next_review` is overdue, its `# Open loops` lists a critical-path blocker, or its tracker shows an external development that invalidates a planned approach. Don't flag projects on velocity alone.
- **Section 7 — Agent opportunities:** open agent_jobs where `status: ready` is the easy case. Also flag any Task with `agent_eligible: true` that's been sitting in `next` for more than a week.
- **Section 8 — Trackers:** due today AND fresh digests with material findings. Trackers that ran but found nothing don't go here.
- **Section 9 — People:** mandatory section even if all four subsections are empty. Honor `sensitivity: private` — summarize one level higher than the source note.
- **Section 12 — Starter prompts:** for each outcome in section 1, write one paste-ready paragraph the user can drop into a fresh agent session. This is the highest-effort section per outcome but pays for itself when the user actually starts the work.
- **Section 13 — End-of-day review prompts:** three short prompts the user will answer at shutdown — usually one per outcome.

### Rules across all sections

- Wiki-link every project, task, person, source, tracker, and digest you mention. Bare titles are a lint failure.
- Never invent deadlines. If `due:` is unknown, write `due: unknown`. Don't guess.
- Honor sensitivity per `_schemas/_privacy.md` — summarize `private` items one level of abstraction higher, never quote `sensitive` items.
- If a required input folder is missing entirely, note the gap in the relevant section ("(no calendar data available — `Ops/Calendars/` is empty)") rather than aborting.

## Step 4 — Log

Append one line to `log.md`:

```
<datetime-with-tz> — agent:planner — brief — [[Ops/Briefings/<date>]] — daily briefing generated; <N> outcomes, <N> at-risk projects, <N> due trackers.
```

## Step 5 — Open in browser via Quartz (default)

The file is the artifact, and the user wants to read it in the browser (rendered HTML with working wikilinks and graph), not the terminal or Obsidian. Run:

```
# 1. Ensure Quartz dev server is up on :{{QUARTZ_PORT}}
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  # Wait for boot — Quartz parses 240+ markdown files, ~4–8s
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break
  done
fi

# 2. Open today's briefing
open "http://localhost:{{QUARTZ_PORT}}/Ops/Briefings/<date>"
```

Substitute `<date>` (e.g. `2026-01-15`). URL preserves directory casing and strips `.md`.

Skip this step only if the user explicitly says "don't open it" or "just write the file." Otherwise it's the default.

(Prior versions of this skill opened the briefing in Obsidian via `obsidian://open?vault={{VAULT_NAME}}&file=...` — that was superseded in favor of Quartz/browser. Memory `feedback_open_artifacts_in_browser` is the canonical statement of the default.)

## Step 6 — Report back

```
Briefing generated: Ops/Briefings/<date>.md (opened in browser at http://localhost:{{QUARTZ_PORT}}/Ops/Briefings/<date>).

<IF Step 2b produced any items:>
**State confirmation needed first** (vault may be lagging reality):
- [[<item 1>]] — still <status>. Was this actually done?
- [[<item 2>]] — ...
Reply yes/no/partial and I'll close the loop.

Top 3 outcomes:
1. <outcome 1>
2. <outcome 2>
3. <outcome 3>

Notable: <one bullet for the most consequential at-risk project or surfaced followup, or "nothing surprising">.
```

Surface the § 0 items at the top of the chat report-back if present — the user reads the chat before opening the briefing file, and closing stale state in the same session is the whole point of the pre-flight. If they reply "yes, all done" for any item, immediately edit the source note (`status:`/`submitted:`/Work log) and append a log entry. The user shouldn't have to re-invoke a separate closure skill for trivially obvious closures.

Don't recapitulate the whole briefing in chat — the file is the artifact.

## What this skill does NOT do

- **Does not silently overwrite.** If today's briefing exists, stop and ask. If it has `## Shutdown notes` appended, refuse the overwrite outright unless the user explicitly says "I know, regenerate and lose the shutdown notes."
- **Does not auto-execute outcomes.** It writes the briefing; the user decides what to actually do.
- **Does not lint.** Lint is a separate weekly task; the briefing surfaces signals but doesn't run check 1–15.
- **Does not modify any of the source notes it reads from.** Projects, Tasks, People, Trackers — all read-only here.

## Model recommendation

`opus`. The synthesis across ~10 input streams is the whole point; downgrading produces a briefing that reads like a list rather than an operating dashboard. Run on the inherited (Opus) model.

## Related

- `Agents/Prompts/daily-briefing.md` — paste-able prompt equivalent.
- `_workflows/daily-briefing.md` — the canonical procedure.
- `_schemas/briefing.md` — the schema.
- `shutdown-review` — the end-of-day counterpart that appends to this briefing.
- `session-start` — the lighter-weight pre-flight (5–10 seconds vs. several minutes here).
- `log-mutation` — the canonical log-append helper.
