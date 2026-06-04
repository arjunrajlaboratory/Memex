---
name: session-start
description: Run the 5-second vault pre-flight — log tail, needs_review Tasks, Inbox/ state, today's briefing existence — and recommend a next action. Use at the start of any non-trivial Memex vault session, or whenever the user asks "where did we leave off", "what should I work on", "what's on my plate", "give me a status", "what's in the inbox/dropbox", or otherwise signals they want a quick pre-flight before doing real work. Reads the last ~10 lines of log.md, the current needs_review queue, the top level of Inbox/, the open Tasks with status next/in_progress, and checks whether today's briefing exists. Returns a compact dashboard plus a recommended next action. Use it proactively as the first move in any session that isn't a one-off question — it's cheap, takes ~5 seconds of tool calls, and prevents the "agent picks up where it shouldn't" failure mode where work duplicates or overlaps with state from the previous session. Skip only if the user has already declared a specific task (in which case launch straight into that task).
---

# Session start — pre-flight read

You are running as **`agent:planner`** for this skill. The user is starting a session and you need to surface state in 5–10 seconds so they can decide what to do next.

## What to read

Run these reads in **parallel** (one message, multiple tool calls):

1. **Log tail** — `log.md`, last ~30 lines (top of file, since newest is on top).
2. **`needs_review` queue** — grep across `Ops/Tasks/` and `Atlas/` for `status: needs_review`. Return file paths only.
3. **`Inbox/` top level** — list everything at `Inbox/` excluding `_filed/` and `README.md`. Anything still here = unfiled.
4. **Today's briefing** — check whether `Ops/Briefings/<today>.md` exists.
5. **Active Tasks** — grep `Ops/Tasks/` for `status: in_progress` and `status: next`, count and sample top 5 by file mtime.
6. **Overdue scheduled-start Tasks** — grep `Ops/Tasks/` for `status: scheduled` AND `scheduled_start:` dates ≤ today. These are tasks that were time-blocked for a moment that has now passed without the user explicitly closing or rescheduling them — they're the highest-friction drift signal because the calendar event has fired and the Task is still pretending to be in the future. Count and list up to 5 with their `scheduled_start` dates.
7. **Overdue Followups** — grep `Ops/Followups/` for `due:` dates ≤ today.
8. **Stale Trackers** — grep `Atlas/Trackers/` for `next_check:` dates ≤ today and `status: active`.

If you have access to Haiku via sub-agents and the user is in a hurry, you can fan these out to Haiku sub-agents in parallel (one per check). For most sessions, doing them inline with parallel Bash/Read tool calls is faster — the overhead of dispatching sub-agents only pays off if there's heavy parsing to do.

## What to output

Format the output as a tight dashboard. Keep it under ~25 lines.

```
## Session start — <YYYY-MM-DD HH:MM>

**Last activity** (from log.md):
- <newest-1-line>
- <newest-2-line>
- <newest-3-line>

**Inputs waiting:**
- Inbox/ top level: <N files | empty>
- Inbox/ unprocessed: <N items | empty>

**Open loops:**
- needs_review: <N>  (e.g., [[X]], [[Y]], +<N-2> more)
- in_progress Tasks: <N>  (e.g., [[Z]])
- next-action Tasks: <N>
- overdue scheduled-start Tasks: <N>  (e.g., [[W]] scheduled <date>)
- overdue Followups: <N>  (e.g., [[A]])
- stale Trackers (next_check ≤ today): <N>  (e.g., [[B]])

**Today's briefing:** <generated | not yet — run daily-briefing prompt>

---

**Recommended next:** <one specific action, picked by the heuristic below>
```

## Heuristic for "recommended next"

Pick exactly one, by priority:

1. **`Inbox/` has unfiled items** → "Run the triage-inbox prompt to file `Inbox/` items." (Cheap, blocks other work because unfiled material represents missed context.)
2. **An overdue scheduled-start Task exists** → "Resolve [[W]] — its scheduled block at <scheduled_start> has passed; close it, reschedule, or convert to `next`." (Drift here is the most disorienting because the calendar already fired; address before picking new work.)
3. **No briefing for today and it's a morning session** (clock before ~14:00 local) → "Generate today's briefing with `/daily-briefing`."
4. **Stale trackers with `next_check ≤ today`** → "Run due trackers (`/run-trackers`); N trackers are stale."
5. **needs_review queue > 5** → "Clear the needs_review queue — N items waiting on you."
6. **Overdue Followup** → "Address [[X]], due <date>."
7. **An `in_progress` Task exists** → "Continue [[Y]]." (Don't fragment focus.)
8. **Otherwise** → "Pick from the N next-action Tasks; [[Z]] looks highest-leverage." (Use importance/urgency from frontmatter if available.)

State your recommendation as one sentence with the relevant wikilink. The user can override; they often will.

## What to skip

- **Don't auto-run** any of the recommended actions. This skill is purely diagnostic — the user decides.
- **Don't lint** (that's a weekly task; lint has its own prompt).
- **Don't append to log.md** for this skill — diagnostic reads are not mutations.
- **Don't enumerate every Task / every Tracker** — counts plus top-3 examples is enough. The user can drill in with a follow-up.

## When to skip this skill entirely

- The user has already specified a concrete task in their first message ("write the X email", "ingest this project"). Launch straight into that task; don't waste tokens on pre-flight.
- This skill has already run this session.
- The user explicitly says "skip the pre-flight" or similar.

## Model recommendation

Run on the inherited model (usually Opus). The reads themselves are mechanical, but the **recommended next action** requires judgment about priorities, and that's an Opus-shaped call. If you want to cut cost, dispatch the eight reads to a Haiku sub-agent and synthesize the dashboard yourself — but for a single session start, the overhead of dispatching isn't worth it.

## Related

- `triage-inbox` skill — when `Inbox/` is non-empty.
- `daily-briefing` skill — when no briefing for today.
- `run-trackers` skill — when trackers are stale.
- `close-task` skill — for resolving overdue scheduled-start Tasks (close or reschedule).
- `lint` skill — for the weekly lint pass (not this skill).
