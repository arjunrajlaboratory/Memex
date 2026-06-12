---
name: shutdown-review
description: Run the end-of-day reflection, append shutdown notes to today's briefing, and cascade a one-line entry to every touched Task's # Work log. Use whenever the user wants the end-of-day reflection / handoff to tomorrow's planner — signaled by phrases like "shutdown review", "wrap up the day", "let's do the shutdown", "end-of-day notes", "shutdown notes", "I'm wrapping up", "before I sign off", "log out my day", "what did I get done today", or direct invocation "/shutdown-review". Walks the user through Top-3-outcomes-actuals + the five reflection questions (what got done, what changed in the graph, what to reschedule, what was learned, what tomorrow's briefing should know), produces structured `# Shutdown notes — <today>` content, appends it to today's briefing under a new `## Shutdown notes` section (or to `Ops/Briefings/<today>-shutdown.md` if the briefing is already very long), updates every mentioned Task's `# Work log` with a one-line dated entry, and logs once to `log.md`. Use end-of-day before context-switching out of the vault — not mid-session. Skill is the auto-triggering counterpart to the paste prompt at `Agents/Prompts/shutdown-review.md`.
---

# End-of-day shutdown review

You are running as **`me` + LLM scribe** for this skill. The user is wrapping up; your job is to ask the five reflection questions in a tight, ~10–15 minute exchange, structure the answers, and persist them — so tomorrow's briefing starts with full context and no work gets lost in the gap between sessions.

## Why this skill exists

The shutdown review is what makes the daily briefing work. Tomorrow's briefing reads yesterday's shutdown notes (when present) and uses them to:

- Seed today's Top 3 outcomes from what slipped or what's still warm.
- Update tomorrow's "Waiting on others" with new commitments.
- Carry forward learnings into the right typed note (Decision / Learning / Concept).
- Capture the user's energy / surprises / mood signals.

Without a shutdown, the next morning's briefing is purely vault-state-driven — accurate but cold. The shutdown injects the user's interpretation, which is what makes the briefing actually useful for decisions.

This skill is also the cheap antidote to the "I forgot to update [[X]]'s Work log" failure mode — by walking the reflection questions, every Task touched today gets a Work-log entry as a byproduct, with no separate ceremony.

## Inputs

- **Date** (optional, default today) — almost always today.
- **The user's verbal answers to the five questions** — gathered conversationally, not in a giant intake form.

## Step 0 — Orient

Read these:

- `Ops/Briefings/<today>.md` — open it. You'll need section 1 (Top 3 outcomes) to ask the actuals question, and you'll be appending the shutdown notes back to this file.
- The last ~20 lines of `log.md` — to know what actually got touched today.
- The most recent prior shutdown (find by reading any briefing file containing `## Shutdown notes`) for tone/format precedent.

If today's briefing doesn't exist, ask: "There's no briefing for today — do you want to do the shutdown anyway, or skip until tomorrow?" The shutdown is useful even without a morning briefing; just skip the "Top 3 outcomes actuals" section and proceed with the five questions.

## Step 1 — Top 3 outcomes: actuals

Look at section 1 of today's briefing. For each outcome (up to three):

> Outcome 1 was "<text>". Did it happen — yes / partial / no? What blocked or unblocked it?

One at a time, in the user's own words. Don't extrapolate from log.md without confirming.

## Step 2 — Walk the five questions

One question at a time. Keep each answer concrete; link every file, task, project, or person.

### Q1. What got done today — by linked file?

List every Task closed, every note created or materially updated, every Decision recorded. The log tail you read in Step 0 is the cheat sheet — read it back to the user as "I see X, Y, Z in the log — anything I'm missing?"

For Tasks closed today: confirm each one's `# Work log` entry exists. If a Task was closed via the `close-task` skill, the entry was added then; if it was closed inline, add it now (one dated line per closed Task).

### Q2. What changed in the graph today that the librarian should know about?

New entities (tasks, projects, people, topics, sources), status changes (active → paused on a project; promoted on an idea), decisions made, relationships added. Flag anything the librarian should propagate to neighboring notes.

This question is the auditor's friend — anything called out here is what tomorrow's `session-start` will surface and what Friday's `weekly-review` will roll into "Got done" + "Decisions."

### Q3. What needs to be rescheduled — to tomorrow, this week, or further out?

For each item, suggest the new date and note why it slipped. If a Task slipped because of an external blocker, also propose updating the Task's `blocked_by:` or `waiting_on:` field — but don't do it without confirmation; the user may decide the right move is to break the Task into two.

### Q4. What did I learn today that should be captured?

Anything that belongs in:

- A **Decision** note (per `_schemas/decision.md`) — if the learning is a defensible choice with rationale. Suggest invoking `/capture-decision` for it. Don't do it inline — too much ceremony for the shutdown moment; queue it.
- A **Concept** page update — if the learning is "I now understand X better."
- A new Source note — if the learning came from reading something the user wants to remember.

Draft the note title and a one-line summary; the librarian (the user, tomorrow, with `/capture-decision` or `/ingest-source`) expands it.

### Q5. What should tomorrow's briefing know?

Surprises, mood, energy level, unresolved open questions, anything the planner needs before generating tomorrow's briefing.

This is the most under-valued question. The user's "I'm wiped" or "this thing is going to bug me until I figure it out" or "I'm worried about the X conversation tomorrow" is exactly what makes the next briefing's Top 3 outcomes feel like the right three, not just three.

## Step 3 — Structure the shutdown notes

Produce a document with this structure:

```markdown
# Shutdown notes — <today>

## Top 3 outcomes: actuals
<one bullet per outcome, with yes/partial/no and the blocker/unblocker>

## 1. What got done
<bulleted list with wikilinks>

## 2. Graph changes for the librarian
<bulleted list>

## 3. Rescheduled items
<one bullet per item: "[[X]] → tomorrow; reason">

## 4. Learnings to capture
<one bullet per learning: type + title + one-line summary>

## 5. Notes for tomorrow's briefing
<free-form paragraph, not a list — the user's voice>
```

## Step 4 — Persist

Two paths depending on how long today's briefing already is:

- **If today's briefing is < ~300 lines (the usual case):** append the shutdown notes as a new `## Shutdown notes — <today>` section at the bottom of `Ops/Briefings/<today>.md`. This keeps the day's full record in one file.
- **If today's briefing is already long:** save the shutdown as `Ops/Briefings/<today>-shutdown.md` (standalone), and add a one-line pointer at the bottom of the briefing: `> Shutdown notes: [[Ops/Briefings/<today>-shutdown]]`.

Either way: bump the briefing's `updated:` to today.

## Step 5 — Cascade to Tasks

For every Task mentioned in section 1 (got done) or section 3 (rescheduled) of the shutdown:

- Open the Task note.
- Append one line to its `# Work log`:
  ```
  - <today> — <one-line summary from the shutdown — what happened or why slipped>.
  ```
- Bump the Task's `updated:`.

For closed Tasks specifically (anything that flipped to `done` or `canceled` today), confirm the Work-log entry exists and the close-task ceremony was completed; if not, run `close-task` for that Task before continuing.

## Step 6 — Queue follow-on captures (don't do them inline)

For each learning in Q4, write a single Task or Followup that says "capture this": `[[Capture <learning> as Decision]]` or `[[<learning> — write up by <tomorrow>]]`. Don't run `capture-decision` from inside `shutdown-review` — too much ceremony for end-of-day. The point is to *queue* the captures so tomorrow's briefing surfaces them.

## Step 7 — Log

Append one line to `log.md`:

```
<datetime-with-tz> — me — review — [[Ops/Briefings/<today>]] — end-of-day shutdown; <N> outcomes hit, <N> rescheduled, <N> learnings queued.
```

## Step 8 — Open in browser via Quartz (default)

The artifact is today's briefing (with the appended `## Shutdown notes`) at `Ops/Briefings/<today>.md`. The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > {{VAULT_PATH}}/outputs/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Ops/Briefings/<today>"
```

Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 9 — Report back

```
Shutdown complete for <today>.
- Outcomes: <N hit, N partial, N missed>
- Tasks closed today: <N>  (Work-log entries verified)
- Rescheduled: <N> (next-action surfaces in tomorrow's briefing)
- Learnings queued for capture: <N>

Tomorrow's briefing will pick this up automatically.
```

If the user has more energy than expected and wants to also run `/capture-decision` or `/triage-inbox` before they actually log off, mention it as an option — but don't initiate.

## What this skill does NOT do

- **Does not run more than 10–15 minutes.** If a question is taking more than two minutes, write a stub and move on. The librarian can expand stubs tomorrow.
- **Does not do the captures.** Learnings get *queued* for capture, not captured inline. The shutdown isn't where Decision notes get drafted; it's where they get scheduled.
- **Does not overwrite existing shutdown notes.** If today's briefing already has a `## Shutdown notes` section, append a new sub-section dated with the time rather than overwriting. (Late-evening shutdowns sometimes happen after an earlier mid-day one.)
- **Does not silently change Task statuses.** Rescheduling a Task means proposing a new date and asking the user; this skill doesn't autonomously flip `next` → `scheduled` or `scheduled` → `next`.

## Model recommendation

`opus`. The reflection questions need real synthesis (especially Q4 and Q5), and the Task / Work-log cascade in Step 5 requires careful attention to which notes were actually touched. Inherit the model.

## Related

- `Agents/Prompts/shutdown-review.md` — paste-able prompt equivalent.
- `daily-briefing` — the morning counterpart; reads yesterday's shutdown notes.
- `weekly-review` — Friday's step-back; the daily shutdowns are its raw material.
- `capture-decision` — queued from Q4, run separately the next day.
- `close-task` — invoked from Step 5 for any Task closed today that didn't go through it earlier.
- `log-mutation` — the canonical log-append helper.
