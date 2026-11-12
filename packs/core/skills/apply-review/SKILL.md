---
name: apply-review
description: Apply the answers the user submitted in the daily briefing review form — close, defer, re-scope, or cancel Tasks; bump People and Projects; file or dismiss captures; create Tasks; draft replies; and do the work behind every "Do it" — through the owning skills, recording each answer in an idempotent ledger so a re-run never applies anything twice. Use whenever review answers arrive — signaled by phrases like "apply my briefing review", "apply the review", "here are my review answers", "I submitted the review", "I filled in the briefing form", "process my review", a pasted block that starts "Briefing review — <date>" (from the clipboard or sent by the review widget), a saved `Inbox/reviews/<date>.json`, answers in the review artifact, or direct invocation "/apply-review" / "/apply-review 2026-11-12". It converts every arrival path into `Inbox/reviews/<date>.json`, asks `scripts/briefing_review.py plan` for the unapplied answers, applies each by its route, marks it in the ledger, annotates the briefing's §0 with what was resolved, logs, and reports grouped by outcome. Outbound messages are always drafts, never sent; a "Do it" answer never closes its own work (it ends at needs_review); only the user's Done or Cancel answer authorizes close-task; sensitive items never go to an external service; unanswered rows are left alone.
---

# Apply the briefing review

You are running as **`agent:planner`** for the bookkeeping, and as **`agent:executor`** for the work behind each "Do it" answer. The user has answered the rows of today's briefing review — the form that [[daily-briefing]] opens — and wants every answer carried out without re-explaining any of them.

## Why this skill exists

The briefing surfaces about a hundred actionable items. The review form lets the user answer all of them in a few minutes: one pill per row (Do it, Done, Defer, Waiting, Make task, …) plus an optional note. That speed only pays off if applying the answers is exact. Each answer has to reach the skill that owns the change (close-task for closes, create-task for new Tasks, triage-inbox for captures), nothing may be applied twice, and none of the vault's guardrails may slip because forty answers came in at once: agents never self-close, outbound messages stay drafts, sensitive notes stay local.

The mechanics live in `scripts/briefing_review.py`, which saves answers, plans what is left to apply, and keeps the ledger. This skill owns the judgment: routing notes, doing the work, and asking when an answer is unclear.

## Inputs

- **Date** (optional) — the review's date, `YYYY-MM-DD`. Defaults to the date in the pasted export's header, else the latest briefing.
- **The answers**, in one of three arrival paths. All three converge on `Inbox/reviews/<date>.json` before anything is applied:

1. **Pasted or sent text export** — a block beginning `Briefing review — <date>` (copied from the page surface, or sent into the conversation by the widget's `sendPrompt`). Save it exactly as received; do not retype or tidy it:

   ```
   python3 scripts/briefing_review.py save --from-export <<'EOF'
   <the export, verbatim>
   EOF
   ```

   The date comes from the export header. The command prints the path it wrote.
2. **A saved file** — the server surface (`/review/<date>` on the local site) already wrote `Inbox/reviews/<date>.json` when the user pressed submit. Nothing to save; go to Step 1.
3. **The review artifact** — when the review was published as a private artifact, the answers live in its database, doc `reviews/<date>` (collection `reviews`, doc id `<date>`). Read that doc with the artifact data tool, write its JSON to a scratch file, and pipe it in:

   ```
   python3 scripts/briefing_review.py save <date> --surface artifact < <scratch file>
   ```

   Add `--draft` when the doc's `submitted` is not `true`. The artifact never held `sensitive` items, so those rows simply have no answer.

If `save` exits 1, show the user the problem it printed (usually an export for a date with no items file, or an id that is not in the items) and stop; do not hand-write the answers file.

**Drafts are not answers.** An answers file with `submitted: false` is an autosave. Do not apply it unless the user says to ("apply what I have so far"); then pass `--include-draft` to `plan`.

## Step 0 — Orient

Read these before applying anything:

- `AGENTS.md` — roles, the "may not do" list, and the writing-style rules for any draft you write.
- `Ops/Briefings/<date>.md` and `Ops/Briefings/<date>.items.json` — the rows the answers refer to.
- `Inbox/reviews/<date>.json` — the saved answers (read it once in full so the notes are in context).
- `_schemas/_privacy.md` — before drafting anything from a `private` or `sensitive` note.

## Step 1 — Plan

```
python3 scripts/briefing_review.py plan <date> --json
```

The plan lists every answer that is not yet in the ledger, each with its `id`, display number `n`, `action`, `params`, `note`, `kind`, `target`, and a `route`. Unanswered rows are not in the plan and mean "leave as is": never touch them. If the plan is empty, everything was already applied; say so and stop.

Treat the `route` as the default and the hard rules below as binding. A note that asks for more than the pill says changes the route to `agent` (see Step 3).

## Step 2 — Order the work

Apply in three passes so quick bookkeeping lands even if the session is interrupted part-way:

1. **Closes and status edits** — `done`, `cancel`, `defer`, `waiting`, `rescope`, `touched`, `push`, `bump`, `pause`, `drop`, `dismiss`, `decide`, and `keep` / `skip` (ledger-only).
2. **Creations** — `create_task`, `file`, `ingest`, `agenda`.
3. **"Do it" work** — every `do` answer and every note routed to `agent`. This is the longest pass; start it only when passes 1 and 2 are marked.

Within a pass, follow the plan's order.

## Step 3 — Apply each answer by its route

Before each change, re-read the target note. If it is already in the state the answer asks for (the Task is already `done`, the capture was already filed), change nothing and mark it `skipped` with a summary such as "already done".

| kind / action | What to do |
| --- | --- |
| task `done` | [[close-task]] to `done`. The user's Done answer is the explicit confirmation close-task needs. Use the note, if any, as the outcome line. |
| task `cancel` | [[close-task]] to `canceled`, with the note as the one-line reason (ask for one in the final question if there is none and the Task is p0/p1). |
| item `done` on a Letter (§ 0) | The clean two-field edit `status: submitted` + `submitted: <date>`, per [[reconcile-from-comms]]. |
| task `defer` (`date`) | Set `due:` to the date. If the Task is `status: scheduled` and its block has passed, also set `status: next` (keep the old `scheduled_*` fields as history). Work-log line: "deferred from <old> to <new> (briefing review)". |
| task `waiting` (`who`) | `status: waiting` and `waiting_on:` the person (a wikilink when a Person note exists). Work-log line. |
| task `rescope` | Edit the Task as the note says: objective, acceptance criteria, effort, steps. If the note changes the title, that is a rename: run the new title through `safe_title`, rename the file, and update every wikilink to it. Work-log line naming what changed. |
| person `touched` | `last_contact:` = the review date (never a future date); recompute `next_touch:` from `contact_cadence`. |
| person `push` (`date`) | `next_touch:` = the date. |
| person `agenda` | If `.claude/skills/meeting-agenda/SKILL.md` exists, use `meeting-agenda`. It is not part of every install; otherwise append the item to a `## Next meeting agenda` subsection under the Person note's `# Open loops` (create the subsection if absent), one dated bullet with the item's wikilink. |
| project `bump` (`date`) | `next_review:` = the date. |
| project `pause` / `drop` | `status: paused` / `status: dropped`. Do not move or archive the file. |
| followup `done` / `defer` (`date`) / `drop` | `status: acted_on` / `surface_on:` = the date with `status: pending` / `status: dismissed`. |
| tracker `defer` (`date`) | `next_check:` = the date. |
| tracker `dismiss`; `drop` on a fresh tracker digest | No note change (the tracker stays active); mark `skipped` with "dismissed for <date>". |
| other `item` answers (`done` / `defer` / `drop` on a Commitment, Ask, or other typed note) | Read that note's schema in `_schemas/` and apply its own equivalent (the closing status, the date field a defer moves). If the schema has no clean equivalent, treat it as unclear (below). |
| any `create_task` | [[create-task]] with `params.title` as the subject, the parent Project/Area taken from the item's target (or the target's own `project:`), and the note as context. |
| capture `file` | [[triage-inbox]] on that one capture only. |
| capture `ingest` | [[ingest-source]] on that capture. |
| capture `dismiss` | `mkdir -p Inbox/_filed/dismissed` and move the capture there. Never delete it. |
| tracker `do` | [[run-trackers]] for that one tracker. |
| decision `decide` | [[capture-decision]] with the note as the decision. If the note is empty, ask in the final question. |
| proposal `skip`, any `keep` | No change. Mark `skipped`; `keep` rows carry into tomorrow's briefing. |
| any `do`, and any note that is more than a pure status change | Route `agent`: you do the work (see "Do it" below). |

Every direct frontmatter edit above also bumps `updated:` and gets its own `log.md` line (Step 5). Every owning skill writes its own log line; do not add a second one.

**Items that came from comms.** When an applied answer has `signal` or `threads` (a reconcile Tier-B proposal shown in § 0), also update [[reconcile-from-comms]]'s ledger and checkbox for it (`confirmed+applied`, or `skipped` for a `keep`/`skip`), so a later standalone reconcile run does not propose it again.

### "Do it" answers

`do` authorizes the work. It does not authorize claiming the work is finished.

- Do the work the row describes, using the owning skill where one exists: `email` for replies, `draft-letter` for letters, `flesh-out-idea` for research, the Task's own `# Starter prompt` or `# Agent handoff` for a Task, the agent_job's own acceptance criteria for a `job` (honor its `human_approval_required`).
- **Outbound messages are always drafts.** Email, Slack, Notion comments, Jira comments, calendar invites: create a draft (`create_draft`, `slack_send_message_draft`, or a file in `Drafts/`) and never send, post, or schedule. "Do it" is not the per-session opt-in that sending requires.
- **Never self-close.** When the agent-side work on a Task is complete, take the Task to `needs_review` through [[close-task]] (its "agent did the work" path), with a Work-log entry saying what was done and what the user must check ("reply drafted in Gmail — review and send"). A `do` never sets `done`, `acted_on`, `submitted`, or a decision. The user closes it later, with a Done answer in tomorrow's review or in chat.
- If the work cannot be finished in this session, leave the target's status alone, add a Work-log line saying how far you got, and mark the answer `failed` with that summary, so the next run picks it up.

### Notes are instructions

A note that only restates the pill ("done", "yes", "next week" on a Defer) is a pure status change: apply the pill. Any other note is an instruction from the user. Route it by judgment, together with the pill when there is one:

- **"draft a reply to Dana saying the budget slips a week"** on a task `do` → draft the email on the Task's thread (from `threads`, else search), mark `drafted`; take the Task to `needs_review` only if the draft finishes its agent-side work.
- **"defer to Monday"** typed as a note with no pill → resolve "Monday" to the next Monday strictly after the review date and apply it as `defer`.
- **"ping Robin with this link: <url>"** on a person `touched` → apply `touched`, then draft the message to Robin containing the link; mark `drafted`.
- **"split into two tasks: data pull and write-up"** on a task `rescope` → [[create-task]] for each new piece under the same parent, then [[close-task]] the original as `canceled` with `superseded_by:` the first new Task — the user's "split" is the explicit instruction to retire it. Report both new Tasks.
- **"drop these"** on a row grouped with others → apply it to that row only. If the note clearly names other rows ("drop 14–17"), apply it to rows whose answers are blank, and say so in the report; never override another row's explicit answer.
- **A note with `action: null`** (exported as `NOTE`), such as "ask Sam whether this is still needed" → do what it says (here, a draft to Sam), change no status, and mark `drafted` or `applied`.

### When an answer is unclear

Do not guess on anything consequential: a close, a cancel, a rename, a message to another person, a decision, anything p0/p1. Mark nothing for those rows, keep going with the rest, and collect them into **one batched question at the end** ("Row 12 says 'fix the date' — which date? Row 31: cancel or just pause?"). Small, reversible ambiguities (which of two equally good Monday dates) you may resolve and state in the report.

## Step 4 — Mark each answer in the ledger

After each answer — not at the end — record it:

```
python3 scripts/briefing_review.py mark <date> "<id>" --result applied|drafted|skipped|failed --summary "<one line: what you did>"
```

- `applied` — the change landed. `drafted` — the outcome is a draft waiting for the user. `skipped` — deliberately no change (`keep`, `skip`, already in the requested state). `failed` — it went wrong; the summary says why.
- **Partial failure:** when one answer fails (a missing note, a tool error, a connector outage), mark it `failed` with the reason and continue with the next answer. Never stop the run for one bad row, and never mark a failed row `applied`.
- **Re-running is safe.** The ledger at `Inbox/reviews/<date>.ledger.json` stores a fingerprint of each answer (`sha1(id|action|params|note)`), and `plan` skips every entry whose fingerprint is unchanged. A second run applies only answers that are new or that the user changed since — a changed answer reappears in the plan, so re-read the target before applying it on top of the earlier change. A `failed` entry is retried only if the user changes that answer or asks you to retry it.

## Step 5 — Annotate and log

When the plan is worked through:

```
python3 scripts/briefing_review.py annotate <date>
```

This rewrites the managed `Review resolved` block in the briefing's § 0 from the ledger. It is idempotent; run it again after any later re-run.

Then append one `log.md` line for each direct frontmatter edit you made (owning skills log their own), and one summary line for the run:

```
<datetime-with-tz> — agent:planner — update — [[<Target>]] — briefing review <date>: <what changed, e.g. "due 2026-11-10 → 2026-11-16">.
<datetime-with-tz> — agent:planner — update — [[Ops/Briefings/<date>]] — apply-review: <A> applied, <D> drafted, <S> skipped, <F> failed, <Q> awaiting your answer.
```

## Step 6 — Report back

Group by outcome, one line per row, with the row number from the form:

```
Applied <A> of <total> review answers for <date>.

Applied:
- [3] [[Send revised budget to Dana]] — deferred to 2026-11-16.
- …
Drafted (waiting for you to send or approve):
- [7] [[Draft reviewer response]] — reply drafted in Gmail; Task → needs_review.
Needs your input:
- [12] [[Lab move checklist]] — "fix the date": which date?
Skipped:
- [20] [[Robin Park]] — keep (carries into tomorrow's briefing).
Failed:
- [31] [[Old capture.pdf]] — file no longer in Inbox/.
```

Leave out empty groups. End with the batched question if there is one. Keep it short; the briefing's § 0 now carries the same record.

## Hard rules (non-negotiable)

- **Outbound messages are always drafts, never sent.** No email, Slack, Notion, Jira, or calendar write leaves the vault as a sent action, whatever the answer or note says.
- **A `do` answer never self-closes.** It ends at `needs_review` with a Work-log entry, and the report says what was done.
- **`done` and `cancel` answers are the user's explicit confirmation** and are what authorize [[close-task]]. Route every close through close-task; never hand-edit `status: done`.
- **`sensitive` items never go to an external service.** Do not send their content to a connector, a web search, or an artifact; draft anything they need in `Drafts/` and tell the user. Never lower a note's sensitivity.
- **Unanswered rows are left alone.** No answer means "leave as is".
- **Autosaved drafts (`submitted: false`) are not applied** unless the user says to.
- **Every applied answer is recorded with `mark`**, one at a time, as you go.

## What this skill does NOT do

- **Does not generate the briefing or the form** — that is [[daily-briefing]].
- **Does not edit the answers.** It reads `Inbox/reviews/<date>.json`; if an answer is wrong, the user changes it in the form (or tells you), and the changed fingerprint brings it back into the plan.
- **Does not triage `Inbox/reviews/`.** Like `Inbox/comms/`, it is a system slot, not a capture.
- **Does not send, post, or schedule anything.**

## Model recommendation

`opus` (inherited). Routing free-text notes and doing the "Do it" work need judgment; the bookkeeping passes are mechanical, but they share one ordered run.

## Related

- [[daily-briefing]] — writes `Ops/Briefings/<date>.items.json`, opens the review, and carries tomorrow's unanswered and kept rows.
- [[close-task]], [[create-task]], [[triage-inbox]], [[ingest-source]], [[run-trackers]], [[capture-decision]] — the owning skills answers route to.
- [[reconcile-from-comms]] — its ledger is updated for § 0 items that came from comms.
- `email` — drafting replies (drafts only).
- `scripts/briefing_review.py` — `save`, `plan`, `mark`, `annotate`.
- `Inbox/reviews/<date>.json` (answers) and `Inbox/reviews/<date>.ledger.json` (the apply ledger).
