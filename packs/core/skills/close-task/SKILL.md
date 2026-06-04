---
name: close-task
description: Close a vault Task as done, needs_review, or canceled — adds the required final # Work log entry, bumps updated, removes from the parent Project's # Current next actions, surfaces unblocked downstream Tasks, and appends the canonical log line. Use whenever the user wants to mark a Task as finished — signaled by phrases like "close [[X]]", "mark this task done", "I finished the integration task", "wrap up that task", "task done: ...", "task complete", "I'm done with the X task", or direct invocation "/close-task [[X]]". Takes a Task to `status: done` per the schema rule that done requires a final `# Work log` entry with the outcome, bumps `updated:`, surfaces any downstream Tasks blocked by this one (the `unblocks:` chain), removes the Task from any parent Project's `# Current next actions` list, and appends the canonical log line. Also handles the partial-done cases: `status: canceled` (with a one-line reason), `status: needs_review` (when the user thinks it's done but wants the auditor to confirm — the standing rule is the agent never sets done on its own work). This is the inverse of `create-task` and the natural close of the Task lifecycle.
---

# Close a Task

You are running as **`agent:executor`** for this skill — but with the hard constraint that you do not mark *your own* work as `done` (per the CLAUDE.md hard-no). If the Task was being done by the user, you can set it to `done` on their say-so. If it was being done by an agent (this skill or any other), set it to `needs_review` and let the user close it.

## Why this skill exists

Closing a Task is more than flipping a field. The schema in `_schemas/task.md` requires:

- `status: done` requires a final entry in `# Work log` describing the outcome.
- `updated:` must be bumped.
- A log line in `log.md` per the standing vault contract.

And there's a graph-level move that's easy to miss: if other Tasks list this one in their `blocked_by:`, they're now unblocked and deserve a moment of attention. Likewise the parent Project's `# Current next actions` list may have a stale bullet pointing at this Task.

Without this skill, all of that gets half-done — the Task becomes `status: done` with no Work-log line, the unblocked downstream Tasks linger in `waiting`, and the project page lies about what's still to do.

## Inputs

- **Task** (required) — a wikilink or path. Accept `[[X]]`, `Task - X`, or `Ops/Tasks/X.md`. If the user said "the integration task" or "that thing I just did," grep recent Tasks by mtime and confirm the match before proceeding.
- **Outcome** (recommended) — a one-line description of what actually happened. If the user didn't say, prompt with a single question: "What was the outcome? (one line — e.g., 'integration worked end-to-end, queued the marketing tweet')." If they decline to say more, accept "done" as the outcome — but flag in the report that the Work-log entry is thin.
- **Optional disposition override:** "cancel it" → `status: canceled`; "I think it's done but check it" → `status: needs_review`.

## Step 0 — Orient

Read these in parallel:

- The Task file in full. You need its current `status`, `blocked_by:`, `unblocks:`, `project:`, `acceptance_criteria:`, and existing `# Work log`.
- `_schemas/task.md` — confirm the `done` rules haven't changed.
- The parent Project page (if `project:` is set) — to check whether the Task is named in `# Current next actions`.
- For each wikilink in `unblocks:`, read the target Task's current `status` and `blocked_by:` so you know what to surface.

If the Task is already `status: done`, stop. Tell the user and ask if they want to re-open or revise instead. (Don't re-close — the timestamp matters.)

## Step 1 — Verify the acceptance criteria

Before flipping the status, walk the Task's `acceptance_criteria:` list (one item per line in the body). For each:

- If the user has clearly satisfied it (described the outcome that matches), check it.
- If a criterion looks unmet, surface it: "Acceptance criterion 3 was 'Decision memo: ready to advertise?'  — is that done? I can keep the Task open and add a follow-up Task instead if not."

This is the moment to catch the failure mode where a Task is closed because "I did the work" but one of the explicit criteria — usually the deliverable-shaped one — is still hanging. Don't be a stickler about it; the user can override. But surface the gap.

## Step 2 — Pick the closing status

| User's situation | `status:` | Required |
| --- | --- | --- |
| Work happened, outcome achieved, user closing their own work | `done` | Final Work-log line. |
| Work happened, but user wants the auditor / a reviewer to confirm | `needs_review` | Work-log line; do NOT bump to done — the user (or the auditor in the weekly review) does that. |
| Work never happened, decision is to drop it | `canceled` | Work-log line stating the reason (1 sentence). `superseded_by:` is empty unless replaced by another Task. |
| Agent did the work | `needs_review` | This is non-negotiable per CLAUDE.md — agents don't self-close. |

If you (the agent running this skill) did the work, the answer is `needs_review`, full stop.

## Step 3 — Update the Task frontmatter

Edit the Task file:

- `status:` → the new status from Step 2.
- `updated:` → today.
- If `status: canceled` and another Task replaces it: `superseded_by: "[[<replacement>]]"`.
- Do NOT clear `scheduled_start` / `scheduled_end` or `due:` even if the date has passed — those are historical record.

## Step 4 — Append to `# Work log`

Add a final entry at the bottom of `# Work log`:

```
- <today> — <one-line outcome>. Status: <previous> → <new>.
```

For `canceled`: include the reason ("Canceled — superseded by [[Y]]" or "Canceled — scope absorbed into project page; no longer a discrete commitment").

For `needs_review`: state who reviews and what they should check ("Needs review by me — confirm that the data pipeline integration is ready to announce; if yes, this can flip to done and unblock [[Post]].").

## Step 5 — Update the parent Project's next-actions list

If the Task had `project:`, open that Project file. If `# Current next actions` lists this Task as a bullet, remove the bullet (or strike it through if the user prefers visible history — default: remove). Bump the Project's `updated:` to today.

If the Project's `# Changelog` is the right place for a "Task closed" mention, append one line. Don't both remove and changelog if the Project doesn't have a Changelog convention; keep the move minimal.

## Step 6 — Surface unblocked downstream Tasks

For every Task in this Task's `unblocks:` list (or every Task whose `blocked_by:` includes this Task — search both directions):

- Open the downstream Task.
- If its only blocker was the just-closed Task, propose to the user that they flip it from `waiting` (or whatever its status is) to `next`. Don't auto-flip — surface and let them decide.
- Update the downstream Task's `blocked_by:` to remove this Task. (This is mechanical bookkeeping; doing it is safe.)

Report the unblocked set explicitly in the wrap-up:

> Unblocked by this close: [[X]] (now next-eligible), [[Y]] (still waiting on [[Z]]).

## Step 7 — Log

Append one line to `log.md`:

```
<datetime-with-tz> — me — update — [[<Subject>]] — status <previous> → <new>; <one-line outcome>; unblocks: [<comma list of newly-next-eligible Tasks>].
```

If `agent:executor` did the work and is closing to `needs_review`, the actor is the agent role, not `me`.

## Step 8 — Calendar follow-up (if relevant)

If the Task had `scheduled_start` / `scheduled_end` and a matching Google Calendar event was created (per `create-task`), the calendar event is now history — leave it. Don't edit the title to add "✓ DONE" or anything; the calendar is a time-truth source, not a status-truth source.

The exception: if the Task was `canceled` and the calendar event is in the future, **suggest** deleting the calendar event. Don't delete without a confirm.

## Step 9 — Report back

```
[[<Subject>]] closed → <new status>.
- Outcome: <the one-liner from the Work-log entry>
- Parent project: <removed from next-actions | not on next-actions list | no parent>
- Unblocked: <comma list, or "none">
- Calendar: <future-event still present and not deleted | no event was created>
```

If the user wants the unblocked downstream Task moved to `next` right away, that's a one-line follow-on confirmation, not part of this skill.

## What this skill does NOT do

- **Does not close on its own initiative.** This skill only fires when the user signals close. An agent never sweeps the Task list looking for things to close.
- **Does not flip the agent's own work to `done`.** Per CLAUDE.md hard-no, agents close their work to `needs_review` and let the user finalize.
- **Does not edit acceptance criteria after the fact.** If a criterion was wrong, the Work-log entry calls that out — the criteria themselves stay as the historical contract.
- **Does not chain into starting the next Task.** Closing is a discrete action. The user picks what's next; `session-start` can help.

## Model recommendation

`opus` if the parent-project edit + unblocks-chain involves judgment about other Tasks' status; `haiku` if it's a clean close on a Task with no dependents. The cheap path dominates — most Tasks have no `unblocks:` entries, and the close is mechanical.

## Related

- `_schemas/task.md` — re-read every invocation.
- `create-task` — the inverse; together they bound the Task lifecycle.
- `weekly-review` — closes the loop at the week scope; this skill closes individual Tasks daily.
- `log-mutation` — the canonical helper for the `log.md` append.
