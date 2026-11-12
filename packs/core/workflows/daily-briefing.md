# Workflow: daily briefing

**Role:** `agent:planner`
**Trigger:** `Ops/Briefings/<today>.md` does not exist; or explicit user request
**Output:** `Ops/Briefings/<today>.md`, plus `Ops/Briefings/<today>.items.json` (the review items) and the briefing review form

## Default loop-closing pass (Step 1b)

Before gathering the inputs below, run the default multi-source loop-closing pass (the
skill version automates this; pasting the prompt, do it by hand): read `_config/sources.md`
for enabled streams and split capture streams (email, Slack, Notion, Jira, and future providers) from
calendar, which is reconciliation-only. When at least one capture stream is enabled, run
`capture-comms` (email/Slack in both directions plus Notion comments/edits and Jira assignments,
comments, transitions, and field mentions) with only those streams, then run
`reconcile-from-comms` for all enabled streams. When no capture streams are enabled, skip capture
and stale digest parsing but still reconcile an enabled calendar; set `includes_comms: false` and
`comms_coverage: skipped`. Tier-A reversible bookkeeping auto-applies; Tier-B task
closes (plus passed calendar-event closes if the `calendar` stream is enabled) become the
numbered `## 0. State confirmation needed` section, confirmed in one batch. Skip this pass
for backfilled briefings more than ~2 days old.

**Ignore stale digests from disabled sources:** before reconciliation, exclude their whole files
by `source:` frontmatter (filename stem for legacy files) from both `## Coverage` and `## Action
items` parsing. Read `## Coverage` only from enabled-source files. If any says `status: partial`,
preserve the exact `coverage gap`, set briefing frontmatter `comms_coverage: partial`, and surface
the warning at the top of §0 and the chat report-back. Positive captured signals remain usable;
absence in an un-scanned source/direction/time range is inconclusive and must never become "not
sent," "no reply," or "quiet." Set `includes_comms: true` only if at least one capture stream
actually ran. Use `comms_coverage: complete` only when every enabled capture source finished,
`partial` when at least one ran but an enabled capture source was incomplete, and `skipped` when
no capture stream ran. Calendar reconciliation never counts as capture coverage.

When reading `_config/sources.md`, also respect `mailboxes.*`: the mail connector searches only
`mailboxes.connected` (legacy vaults: `mailboxes.gmail_connected`). Forwarding-in addresses can make received mail visible, but sent
mail from that address, or from `mailboxes.other_sending_accounts`, is invisible unless those
mailboxes are separately connected. For outbound-contact tasks, an empty connected-mailbox
`in:sent` result is therefore **inconclusive**, not evidence of "not sent"; surface it as
"couldn't confirm from the connected mailbox — did this go from another account?" instead of
"awaiting send." Independently of accounts, `search_threads` can return a **stale** cached view
of even the connected mailbox — days behind reality, and unrefreshed by repeating the search — so
confirm a specific thread with `get_thread(threadId)` and never read "not sent" off an empty
search.

## Inputs to read

- `log.md` since the last briefing
- `index.md`
- All active projects (`Atlas/Projects/*.md` with `status: active`)
- All open tasks (`Ops/Tasks/*.md` with `status not in [done, canceled]`)
- All waiting-for / I-owe items (filter tasks + commitments)
- All unprocessed inbox captures (skip the `Inbox/` system slots: `_filed/`, `_journal/`, `comms/`, `reviews/`)
- Calendar events for today and the next 7 days (from `Ops/Calendars/` if present)
- All agent jobs with `status: needs_review` or `ready`
- All due trackers (`status: active` AND `next_check <= today`)
- All recent tracker digests (`run_at >= today - 1`) where `material: true` AND
  `status: complete`; exclude `partial` and `failed` write-ahead digests
- All followups with `surface_on <= today` and `status: pending`
- All people whose `next_touch <= today` and `status: active`
- The previous review's carry-over: `python3 scripts/briefing_review.py carryover <previous briefing date> --json`
  (it exits 1 when that day has no items file or no submitted review; then skip silently). Place
  each carried item — unanswered, `keep`, or a `defer` that has come due — in its natural section,
  marked as carried, reusing the `id` the carryover output reports verbatim; never drop one just
  because nothing new happened, and never carry an item whose answer was applied. Drop a carried
  item whose target is already closed.

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

## Review items and the review form

After saving the briefing, write `Ops/Briefings/{{today}}.items.json` (`schema:
"memex.briefing-items/v1"`): one entry per actionable list item in §0 and §§3–11 (and a
principal-asks section if the briefing has one) — never §1, §2, §12, or §13. Each entry carries a
`id` (`<kind>:<target path without .md>`, stable across days; with no target, print it with
`python3 scripts/briefing_review.py id --kind <kind> --section <section> --date {{today}} --text
"<text>"` — such ids are per-day, so a carried target-less item keeps the id from the carryover
output), `section`, `kind` (from the target's folder: task, person, project,
capture, tracker, followup, job; every §11 entry is `decision`; create proposals are `proposal`;
anything else is `item`), and `text` (the briefing's Markdown, wikilinks kept). Read `status` and
`due` from the target's frontmatter, copy `signal` and source-prefixed `threads` for
reconcile-sourced items, inherit `sensitivity` from the target (default `private`; the artifact build re-checks the note's
frontmatter and never trusts this field alone), list other
sections in `also_in` instead of repeating an item, mark carried items with `carried_from` and
`previous`, and set `actions` only to narrow the kind's default. Then run `python3
scripts/briefing_review.py validate {{today}}` and fix every reported problem before continuing.
Regenerating the briefing overwrites the items file together with the `.md`.

Open the review on the surface named by `review_surface` in `_config/overrides.md` (absent =
`auto`: an inline widget when the session has one, else the local site's `/review/{{today}}`
route when the site is up, else the standalone page from `python3 scripts/briefing_review.py build
{{today}}`). The artifact surface is used only on request, always private and redacted (by default
private and sensitive items are withheld and stay local-only; loosening needs the user's say-so). The user
answers in the form; the `apply-review` skill applies the submitted answers. A chat reply such as
"yes to 1,3" remains a valid fallback for the §0 closes.
