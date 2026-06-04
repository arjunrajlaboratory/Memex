---
name: create-task
description: Create a vault Task conforming to _schemas/task.md with a sequential task-YYYYMMDD-NNN id, the right parent project/area, and (when there's a time block) a matching Google Calendar event. Use whenever the user wants to spin up a new Task in the vault — signaled by phrases like "add a task to ...", "create a task for ...", "I need to ...", "make a task to ...", "task: ...", "schedule a block to ...", "put time on for ...", "block 30 min tomorrow for ...", "remind me to ...", "I should do X by Y", or direct invocation "/create-task". Generates a sequential `task-YYYYMMDD-NNN` ID, conforms to `_schemas/task.md` (including the rule that `status: scheduled` requires both `scheduled_start` and `scheduled_end`), picks the parent Project / Area from the existing vault, optionally creates a matching Google Calendar event when there's a time block, and always appends the canonical line to `log.md`. Use this any time a Task note will be born — even from inside other skills (`triage-inbox` routes Task-shaped captures here; `promote-idea` calls it for Idea → Task promotions). The win is enforcing the ID + schema + log + calendar discipline in one move so the Task isn't half-formed.
---

# Create a Task

You are running as **`agent:capture`** (when invoked directly by the user on a fresh capture) or as the orchestrator's continuation of `agent:librarian` / `agent:planner` (when invoked from inside `triage-inbox`, `promote-idea`, or the briefing). Your job: write one schema-conformant Task note, optionally create a calendar event for it, and log — in one motion.

## Why this skill exists

Without it, every Task creation re-derives the same chores by hand: pick today's next sequential ID, remember that `status: scheduled` requires both `scheduled_start` and `scheduled_end`, find the right parent project from the seven ExampleProject sub-projects (or whatever the right cluster is), remember that a time-blocked task should usually also be on Google Calendar, and remember to append to `log.md`. That's seven independent steps, and at least two of them get skipped in any given session. This skill codifies them.

It also enforces the **bidirectional contract** between a Task with a `scheduled_start` and a Calendar event: if the user said "put time on tomorrow at noon," the Task and the calendar block should be created together, with a link in the calendar description back to the Task file.

## Inputs

- **Subject** (required) — a concise imperative ("Test the data pipeline integration in ExampleProject end-to-end"). Lift from the user's phrasing.
- **Parent** (almost always required) — Project or Area wikilink. Per `_schemas/task.md`, a Task without a project is permitted only if `area:` is set; the auditor flags Tasks with neither.
- **Time block** (optional) — phrases like "tomorrow at noon", "Friday 2pm for an hour", "30 min on Monday" — convert these to a `scheduled_start` / `scheduled_end` pair in ISO local format and the user's local timezone (`{{TIMEZONE}}` by default).
- **Owner** (default `me`) — only override if the user names a person/agent.
- **Effort / energy / priority** — infer from phrasing where you can; otherwise use sensible defaults (`effort: 30m`, `energy: medium`, `priority: p2`).

## Step 0 — Orient

Read these (in parallel) before doing anything:

- `_schemas/task.md` — the source of truth on frontmatter. Re-read every time; it evolves.
- The last ~10 lines of `log.md` to avoid duplicate creates and to see what's been happening.
- Grep `^id: task-YYYYMMDD-` across `Ops/Tasks/*.md` for today's date to find the next sequential number.
- If the user named a parent like "the data pipeline project" or "the ExampleProject growth thing," `ls Atlas/Projects/` and pick the best match; show the path before writing.

## Step 1 — Confirm the shape (one tight back-and-forth, not an interrogation)

If the user gave a clear sentence like "add a task to test the data pipeline integration tomorrow at noon for 30 min, ExampleProject project," you have everything — proceed.

If a critical field is missing, ask **one focused question** combining the gaps:

> Going to write [[<Subject>]] under [[<Best-Guess>]], 30 min, no time block. Confirm — or want to change the project or time-block it?

Don't over-ask. The user explicitly said "without stopping for clarifying questions" is the standing preference on this vault; make a reasonable call and proceed when in doubt.

## Step 2 — Generate the ID

Today is `<today YYYYMMDD>`. Grep `^id: task-<today>-` across `Ops/Tasks/*.md`. The next ID is the highest existing number + 1, zero-padded to three digits (`task-20260518-003`). If none exist for today, start at `001`.

**Edge case:** when invoked twice in the same turn, the file system won't have caught up — be careful to use distinct IDs for each Task written in a single message.

## Step 3 — Pick the status

| User said... | `status:` | Notes |
| --- | --- | --- |
| "Add a task to..." (no time block) | `next` | Default for actionable items. |
| "Block 30 min tomorrow to..." / "Put time on Friday for..." | `scheduled` | Requires both `scheduled_start` and `scheduled_end`. |
| "Some day / eventually / backlog" | `backlog` | Future-you problem. |
| "I'm starting on this now" | `in_progress` | Rare — most "create" is for future work. |
| "Waiting for X before I can start" | `waiting` | Requires `waiting_on:` populated. |

If `status: scheduled` is right but the user gave a date but not a time, default to a 09:00 local start; ask only if the ambiguity would actually mislead.

## Step 4 — Write the Task note

Path: `Ops/Tasks/<Subject>.md`. Conform to `_schemas/task.md` exactly. Required body sections per the schema: `# Objective`, `# Context`, `# Inputs`, `# Steps`, `# Acceptance criteria`, `# Risks / constraints`, `# Work log`.

Frontmatter rules worth being precise about:

- `created:` and `updated:` are both today.
- Wikilinks in YAML are quoted: `project: "[[ExampleProject Platform]]"`.
- `scheduled_start` / `scheduled_end` are ISO local datetime *without* timezone suffix — the vault's convention from the existing Tasks is `2026-05-19T12:00`. The timezone is conveyed via the calendar event.
- `acceptance_criteria:` is a list of strings — write **the same** list you put under `# Acceptance criteria` in the body. The schema requires they match.
- For agent-eligible tasks (rare for create-task — usually the user is committing to do it themselves), also populate `# Agent handoff` per `Agents/Prompts/_agent-handoff.md`.

Seed `# Work log` with a single creation line:

```
- <today> — Task created <and time-blocked for <scheduled_start> if applicable>.
```

## Step 5 — Create the calendar event (when scheduled)

If and only if `status: scheduled`, create a Google Calendar event on the user's primary calendar.

- Summary: the Task subject (or a lightly cleaned version — strip trailing schema-words like "end-to-end" if it makes the calendar event noisier).
- Start / end: the ISO datetimes from the Task, in `{{TIMEZONE}}` (unless the user specified another zone).
- Description: a one-sentence outcome statement + a link to the Task file path. Example: `Exercise the data pipeline integration end-to-end on a real public dataset before advertising the feature. Linked vault task: Ops/Tasks/Test data pipeline integration in ExampleProject.md`
- Don't add attendees, don't ask for a Meet link, don't set reminders unless the user said to.

Capture the calendar event ID if the API returns one: write it to the Task's `calendar_event_id:` frontmatter (and the event summary to `calendar_event_title:`) **and** mention it in the `# Work log` line so the bidirectional link is recoverable. The frontmatter field is what lets the daily briefing's calendar loop-closing later ask "this event's time has passed — close the task?" (gated on the `calendar` stream in `_config/sources.md`).

If the user didn't time-block, skip this step entirely — don't ask whether they want a calendar event. A `status: next` Task is a list item; the calendar belongs to time-blocked work.

## Step 6 — Log

Append one canonical line to the top of the `---` divider in `log.md` (newest first per the file's convention):

```
<datetime-with-tz> — <actor> — create — [[<Subject>]] — <one-line summary including parent project, status, and whether a calendar event was created>
```

Use the same actor (`me` if user-driven, `agent:capture` / `agent:planner` / `agent:librarian` if a parent skill invoked this). If a parent skill is in flight, defer to its actor — don't switch mid-flow.

If you find yourself writing a multi-line entry, you're describing too much — one sentence per mutation is the contract.

## Step 7 — Report back

Compact:

```
Created [[<Subject>]] (<status>, <effort>, <parent>).
<If scheduled: "Calendar event '<summary>' on <date> <start>–<end> ET.">
Logged.
```

If you also want to propose the next move (e.g., "want me to also draft a starter prompt for this?"), one line at the end — but only one.

## What this skill does NOT do

- **Does not invent a parent.** If the user genuinely hasn't specified a project or area and the subject doesn't pattern-match an existing one, ask. Orphan Tasks get flagged by the auditor.
- **Does not set `status: done`.** That's `close-task`'s job and has its own ceremony (final Work-log entry, the `unblocks:` chain).
- **Does not modify other notes.** It only writes one Task file + maybe one calendar event + one log line. If the Task should be added to a Project page's `# Current next actions` list, propose that as a follow-on — don't silently edit other notes.
- **Does not duplicate a calendar event.** Before creating one, look at recent calendar events in the same window — if the user already has a block named identically, link to that instead.
- **Does not skip `log.md`.** Even the simplest Task creation appends one line. This is the highest-leverage discipline; without it, the auditor can't tell why a Task exists.

## Model recommendation

`opus` (inherited) when the parent project / area is ambiguous and needs a judgment call. `haiku` is fine for the rote case where the user gave a fully specified Task and you're just writing the file. The expensive step is the schema check, not the writing.

## Related

- `_schemas/task.md` — the schema; re-read every invocation.
- `close-task` — sibling skill for the `done` transition.
- `triage-inbox` — calls this skill when a capture classifies as a Task.
- `promote-idea` — calls this skill when an Idea promotes to a Task.
- `log-mutation` — the canonical helper for the `log.md` append. This skill calls it (or inlines the same line format).
- `Agents/Prompts/_task-starter.md` — pair with this skill when the user immediately wants a starter prompt for the new Task.
