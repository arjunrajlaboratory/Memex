---
name: daily-briefing
description: Generate today's 13-section operating-dashboard briefing for the vault (Top 3 outcomes through End-of-day prompts), open it in the browser, and refuse silent overwrites. Use whenever the user wants today's operating dashboard generated — signaled by phrases like "generate the daily briefing", "today's briefing", "what's the briefing for today", "make today's briefing", "give me the morning briefing", "what's on for today (full version)", or direct invocation "/daily-briefing" / "/daily-briefing 2026-05-19". Synthesizes the vault's current state into `Ops/Briefings/<YYYY-MM-DD>.md` per `_schemas/briefing.md` and the full procedure in `_workflows/daily-briefing.md` — reads active projects, open tasks, waiting-for items, unprocessed inbox, calendar for today + next 7 days, agent jobs, due trackers and fresh digests, surfaced followups, people needing a touch — and produces the 13-section briefing body (Top 3 outcomes, Calendar / time map, Tasks due today, Waiting on others, Projects at risk, New captures needing triage, Agent opportunities, Trackers, People, Followups surfaced today, Decisions needed, Starter prompts, End-of-day review prompts). Alongside the Markdown it writes `Ops/Briefings/<date>.items.json` (one entry per actionable item, carrying over yesterday's unanswered and kept review items) and opens a keyboard-first briefing review form — an inline widget, the local site's `/review/<date>` page, or a standalone page — whose submitted answers the `apply-review` skill applies. Refuses to overwrite an existing briefing without explicit confirmation. By default it first runs capture-comms + reconcile-from-comms to close loops from enabled email, Slack, Notion, and Jira streams (and calendar if enabled in `_config/sources.md`) before synthesizing, so the briefing reflects work you did off-vault. Use first thing in the morning before starting work, once per day; this skill is the auto-triggering counterpart to the paste prompt at `Agents/Prompts/daily-briefing.md`.
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

(Regenerating is safe with respect to Step 1b: both [[capture-comms]] and [[reconcile-from-comms]] are idempotent — capture regenerates its files in place; reconcile's ledger blocks any double-apply.)

## Step 1b — Close loops from comms (default loop-closing)

This is the default multi-source pass that keeps vault state from lagging reality. It runs **before** synthesis so §0 and the task list reflect what actually happened off-vault (you answered an email, posted in Slack, a meeting ended).

1. **Read `_config/sources.md`.** Determine which streams are `enabled: true`, and separately track the enabled **capture streams** handled by [[capture-comms]] (email, Slack, Notion, Jira, and any future capture providers). Calendar is reconciliation-only and is not a capture stream. Also read `mailboxes.*` if present: `mailboxes.connected` (legacy vaults: `mailboxes.gmail_connected`) is the only mailbox the mail connector searches; `mailboxes.forwarding_in` may cover received mail only; `mailboxes.other_sending_accounts` are outbound identities whose sent mail is invisible unless separately connected. If the file is absent (older vault), default to **email + slack enabled, Notion + Jira disabled, calendar planning-only**. If no streams of any kind are enabled, skip to Step 2 — the §0 stale-state queries remain as the fallback safety net.

2. **Backfill guard.** If `<date>` is more than ~2 days in the past (a backfilled briefing), **skip the comms refresh** — a comms scan only makes sense near today — and note `(comms refresh skipped — backfilled briefing for a past date)` in §0. Generate from vault state alone.

3. **Run [[capture-comms]]** for `<date>` only when at least one capture stream is enabled, passing only those enabled capture streams. It is read-only against every external source and handles a per-source MCP outage gracefully (writes a gap note, continues), so a missing connector never fails the briefing. This refreshes `Inbox/comms/<date>/`. **Ignore stale digests from disabled sources:** using `source:` frontmatter (or the filename stem for legacy files), read `## Coverage` only from files whose source is in the enabled capture-stream set resolved in item 1. Retain each selected `status: partial` / `coverage gap` with its source, direction, un-scanned time range, and reason. A partial scan's positive hits are usable, but absence inside its gap is inconclusive. If no capture streams are enabled, skip capture and digest parsing, but continue to item 4 so an enabled calendar can still reconcile passed events.

4. **Run [[reconcile-from-comms]]** for `<date>` in its **briefing sub-mode** (see that skill's "When invoked by daily-briefing"): it auto-applies Tier-A reversible bookkeeping (bump `last_contact`, mark Followups `acted_on`) and **returns the Tier-B proposals plus any coverage gaps** — task closes, Letter→submitted, and (if the `calendar` stream is enabled) passed-event closes — **without prompting**. Hold those proposals and gaps for §0 and the batched report-back (Step 6).

Tasks that Tier-A already advanced will read correctly through the rest of the briefing. Tier-B proposals are **not** applied here — the user confirms them in one batch in Step 6, preserving the "agents never self-close" guardrail.

Coverage frontmatter records capture execution independently of calendar reconciliation.
`includes_comms` is true only if at least one capture stream actually ran. If no capture streams
ran — including a calendar-only Step 1b — set `includes_comms: false` and
`comms_coverage: skipped`. When one or more capture streams ran, use `partial` if any enabled
capture source was incomplete and `complete` only if every enabled capture source completed.

If the contact/send status depends on mail that may have been sent from a non-connected account, the comms pass can only return an **inconclusive** prompt ("couldn't confirm from the connected mailbox; did this go from <account>?"). Never convert an empty connected-mailbox sent-mail search into "not sent" / "awaiting send" when the relevant thread may live in `mailboxes.other_sending_accounts` or the forwarding-in account's own sent folder.

There is a second, orthogonal reason never to read "not sent" off an empty search: `search_threads` can return a **stale** snapshot of the connected mailbox *itself* — observed days behind reality, and unchanged by re-running the same query — so an empty `in:sent` is not proof a send didn't happen even when no other account is in play. Confirm a specific thread with `get_thread(threadId)` (live ground truth), cap an unconfirmed send at "couldn't confirm," and if the user says they sent it, believe them and reconcile accordingly.

## Step 2 — Gather inputs (in parallel)

Run these reads in parallel — one message, multiple tool calls. Read only what exists; skip gracefully if a folder is absent.

1. **Active projects** — `Atlas/Projects/*.md` where `status: active`.
2. **Open tasks** — `Ops/Tasks/*.md` where `status` not in `[done, canceled]`.
3. **Waiting-for / I-owe items** — tasks and commitments flagged as `waiting`.
4. **Unprocessed inbox captures** — `Inbox/` top level (excluding `README.md` and the system slots `_filed/`, `_journal/`, `comms/`, and `reviews/` — none of them are captures).
5. **Calendar events** — `Ops/Calendars/` for today + the next 7 days. (If a calendar-connector read is available and recently authorized, pull from there too — but the vault copy is the source of truth.)
6. **Agent jobs** — `Agents/Jobs/*.md` where `status` in `[ready, needs_review]`.
7. **Due trackers** — `Atlas/Trackers/*.md` where `status: active` AND `next_check <= <date>`.
8. **Fresh digests** — tracker digest notes where `run_at >= <date> - 1` AND `material: true` AND
   `status: complete`. Never surface a `partial` or `failed` write-ahead digest.
9. **Surfaced followups** — `Ops/Followups/*.md` where `surface_on <= <date>` AND `status: pending`.
10. **People needing a touch** — `Atlas/People/*.md` where `next_touch <= <date>` AND `status: active`.

Also pull yesterday's briefing's "## Shutdown notes" section if present — it carries the user's last signal about energy, surprises, and unresolved questions, which directly informs today's Top 3 outcomes.

## Step 2a — Carry over the previous review

Run this alongside the Step 2 reads. Find the previous briefing date — the newest `Ops/Briefings/YYYY-MM-DD.md` dated before `<date>` — and run:

```
python3 scripts/briefing_review.py carryover <previous briefing date> --json
```

If there is no previous briefing, or the command exits 1 because that day had no review (no items file, no answers), skip this step silently — say nothing about it in the briefing or the chat.

Otherwise the output lists the items today's briefing must carry: rows the user left unanswered, rows answered `keep`, and `defer` rows whose date has come due (the CLI applies the date cutoff). It also returns every answer from that review, for pre-filling. Treat it like this:

- **Place each carried item in its natural section** (a Task in §3 or §4, a Person in §9, a Followup in §10, and so on), not in a separate "carried" pile. Re-read its target note first: if the target is gone, or is already closed (`done`, `canceled`, `acted_on`, `dismissed`, `archived`, `dropped`), drop the item — the state was resolved some other way, for example through the chat "yes to 1,3" fallback.
- **Do not drop a carried item just because nothing new happened.** A quiet day is the normal case for a `keep`; the item stays on the list until the user answers it with something other than `keep`.
- **Mark it as carried** in the items file (Step 3b): `carried_from: <previous briefing date>` and, when the user answered it, `previous: {date, action, params, note}` copied from the carryover output. In the Markdown, append ` (carried from <previous date>)` to the line.
- **Items whose answers were applied are not carried** (`done`, `cancel`, `drop`, `dismiss`, `skip`, `create_task`, and the rest). The carryover output already leaves them out; do not add them back with a `carried_from` marker. If vault state surfaces the same note again on its own merits (say, the Task created from a `create_task` answer is due today), it appears as a normal item.

## Step 2b — Build § 0 "State confirmation needed"

§ 0 is populated from **two sources, merged and deduped**:

- **(a) Reconcile Tier-B proposals** returned by [[reconcile-from-comms]] in Step 1b — real signal from your actual sent/received comms and (if enabled) calendar. These are the high-confidence items.
- **(b) The four vault pre-flight queries below** — the safety net for state changes that *no* comm covered (e.g. a scheduled block that simply passed with no email, Slack, Notion, or Jira activity about it).

When (a) and (b) point at the same note, keep the reconcile proposal (it carries the signal) and drop the duplicate. If Step 1b was skipped (no streams enabled, or the backfill guard fired), § 0 is just (b).

**Coverage gaps are warnings, not state proposals.** If any **enabled-source** capture file says
`status: partial`, render `## 0. State confirmation needed` even when there are no numbered closes.
Put this warning first: `> ⚠️ Comms coverage is partial — <source/direction>: <un-scanned range>
(<reason>). Absence in that range is inconclusive.` Do not create an "awaiting send," "no reply,"
or "quiet" item from the uncovered range. Set frontmatter `comms_coverage: partial`; otherwise use
`complete` when every enabled capture source completed and `skipped` when no capture stream ran.
A disabled source's leftover digest never participates in this status, and calendar
reconciliation alone never upgrades capture coverage.

For outbound-contact tasks (reply/send/email/follow-up tasks), do **not** infer "awaiting send" from stale note state alone when email is enabled. Step 1b's live comms capture (or a same-day `Inbox/comms/<date>/` digest) is the prerequisite. If the connected-mailbox search missed the send but the task/person uses a non-connected sending account, render the item as "couldn't confirm from the connected mailbox — may have gone from <account>" and ask the user, rather than asserting it remains open. The connected-mailbox search can also be **stale** (the search index lags reality and a repeat search won't refresh it), so a send that search can't see is "couldn't confirm" even without a second account — verify the specific thread with a full-thread read (Gmail: `get_thread(threadId)`) before asserting anything, and never emit "awaiting send" / "unsent" off an empty search.

Four pre-flight queries (run in parallel):

1. **Letters still `drafting` near deadline** — `Atlas/Letters/*.md` where `status: drafting` AND `due <= <date> + 7`. Most common gap (user submits by email or portal upload, never edits the Letter note).
2. **Tasks `needs_review` past due by >3 days** — `Ops/Tasks/*.md` where `status: needs_review` AND `due <= <date> - 3`. Usually represents work the user actually finished but didn't close.
3. **Tasks `in_progress` with stale work log** — `Ops/Tasks/*.md` where `status: in_progress` AND last `# Work log` entry older than 5 days. Either drift (should close) or genuine in-flight work (legitimate).
4. **Scheduled tasks whose block has passed** — `Ops/Tasks/*.md` where `status: scheduled` AND `scheduled_end < now`. The single most common lag case: a time-blocked task came and went without being closed *or* rescheduled. Surfacing these is how the next morning's briefing catches "I had a full day and four blocks slipped." Multiple scheduled blocks can silently carry because the original three queries didn't cover scheduled-but-not-closed; this query is the fix.

For each item (from either source), render a line in a new **`## 0. State confirmation needed`** section at the very top of the briefing (above § 1) — exactly this format:

```markdown
## 0. State confirmation needed

<IF CAPTURE PARTIAL:>
> ⚠️ Comms coverage is partial — <source/direction>: <un-scanned range> (<reason>). Absence in that range is inconclusive.

<IF THERE ARE STATE PROPOSALS:>
The vault thinks the following are still in progress. Were any of them already done?

1. [[<Task or Letter wikilink>]] — `status: <current>` (due <date>).
   ↳ signal: <e.g. "you emailed Alex the draft 2026-06-03" — present for reconcile-sourced items; omit for pure stale-state hits>
2. ...

Answer these in the briefing review (they open the form), or reply with the numbers that are done (e.g. "yes to 1,3") and the planner will close them via [[close-task]].
```

Number the items so the Step 6 batched confirm ("yes to 1,3,4") maps cleanly; the same number is each item's `label` (`#1`, `#2`, …) in the review items file. Omit §0 only when
there are no reconcile proposals, no query hits, **and no coverage gaps** — its absence then means
the pass completed without surfacing stale state or partial capture.

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
includes_comms: <true if at least one capture stream ran; false otherwise>
comms_coverage: <complete | partial when capture ran; skipped if no capture streams ran>
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

## Step 3b — Write the review items (`Ops/Briefings/<date>.items.json`)

The briefing review form is built from a structured copy of the briefing's actionable items. Write it right after the Markdown, with the `Write` tool, at `Ops/Briefings/<date>.items.json`. Regenerating the briefing overwrites this file together with the `.md` — never leave a stale items file next to a fresh briefing. (An existing `Inbox/reviews/<date>.json` stays valid across a regeneration because answers are keyed by item `id`, not by position.)

```json
{
  "schema": "memex.briefing-items/v1",
  "date": "<date>",
  "generated_at": "<same timestamp as the briefing frontmatter>",
  "items": [ … ]
}
```

**Which lines become items.** One entry per actionable list item in § 0 and §§ 3–11, plus a principal-asks section if this vault's briefing has one (`"section": "asks"`). Not § 1 (Top 3 outcomes), § 2 (calendar), § 12 (starter prompts), § 13 (end-of-day prompts), the § 0 coverage warning, or gap notes such as "(no calendar data available …)". Order the entries as they appear in the briefing; the form numbers rows by that order, and the number is never stored.

**Fields per item.** `id`, `section`, `kind`, and `text` are required; include the rest when they apply.

| field | rule |
| --- | --- |
| `id` | `<kind>:<target path without .md>` when the item has a target note (`task:Ops/Tasks/Send revised budget to Dana`). A target that is not Markdown (an `Inbox/` PDF) keeps its extension. With no target: `<kind>:<date>:<section>:<first 8 hex of sha1 of the plain text>` — plain text is `text` with `[[`/`]]`, backticks and emphasis markers removed; compute it with `python3 -c 'import hashlib,sys; print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:8])' "<plain text>"`. Ids must be unique within the file and stay the same across days, which is what makes carry-over work. |
| `section` | The section number as a string (`"0"`, `"3"` … `"11"`), or `"asks"`. |
| `section_title` | The heading text without its number; for §§ 8–9 add the subsection: `"People — I owe"`, `"Trackers — Due today"`. |
| `label` | § 0 only: `#<n>`, the number printed in § 0, so a chat "yes to 1,3" and the form refer to the same rows. |
| `group` | Optional: a bold group label inside a section (the project a block of tasks sits under). |
| `kind` | From the target note's folder: `Ops/Tasks/` → `task`; `Atlas/People/<Name>.md` → `person`; `Atlas/Projects/` → `project`; an `Inbox/` capture → `capture`; `Atlas/Trackers/<Tracker>.md` → `tracker`; `Ops/Followups/` → `followup`; `Agents/Jobs/` → `job`. Every § 11 entry is `decision`, whatever it links to. A reconcile Tier-B *create* proposal, or any suggestion to start something that has no note yet, is `proposal`. Everything else — a Commitment, an Ask, a Letter, a fresh tracker digest, a line with no target — is `item`. |
| `target` | Vault-relative path of the note the line is about, with extension (`Ops/Tasks/Send revised budget to Dana.md`): the leading wikilink, resolved to its real file. Confirm the file exists; omit `target` rather than guess. |
| `text` | The briefing's Markdown for the line, without the list marker or number, wikilinks kept. |
| `detail` | The `↳` continuation lines, one string each, without the arrow (`"signal: you emailed Dana the draft 2026-11-09"`). |
| `status`, `due` | Read from the target note's frontmatter, never from memory or the previous briefing. `due` is the date a `defer` would move: Task `due`, Followup `surface_on`, Person `next_touch`, Project `next_review`, Tracker `next_check`. Omit when the field is empty — never invent one. |
| `signal`, `threads` | Reconcile-sourced items only: `signal` is the `↳ signal:` text; `threads` lists each `↳ thread:` locator with its source prefix (`gmail:<threadId>`, `notion:<page id>`, `jira:<issue key>`). Skip `n/a` locators (Slack). |
| `sensitivity` | Inherited from the target note's `sensitivity:` (`normal`, `private`, `sensitive`). Use `private` when there is no target or the field is missing, and `sensitive` for anything a comms digest marked `[sensitive — summarized]`. Never lower it. |
| `also_in` | When the same `id` would appear in more than one section, emit it once — at its first appearance — and list the other section numbers here (`["3"]`). |
| `carried_from`, `previous` | Carried items only, from Step 2a. |
| `actions` | Omit to get the kind's default pills. Set it only to *narrow* that list: a § 0 Letter becomes `["do", "done", "defer", "keep"]` (`done` = submitted); a fresh tracker digest becomes `["do", "create_task", "drop"]`. Never add an action the kind does not have, and keep `do` first. |

Then validate:

```
python3 scripts/briefing_review.py validate <date>
```

Exit 0 means the file is good. On exit 1, read the printed problems, fix the items file (duplicate ids, a missing required field, an unknown kind or action, a bad section), and re-run until it passes. Do not continue to Step 4 with a failing file; the review form would be missing rows or refuse to build.

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
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > {{VAULT_PATH}}/outputs/quartz-serve.log 2>&1 & disown )
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

## Step 5b — Open the review

The review is the form where the user answers every item in the items file: one row per item, action pills (`Alt+1` is always "Do it"), a note field, and a submit step that hands the answers back. Skip this step only when the user said "don't open it" or "just write the file", the same as Step 5.

**Pick the surface.** Read `review_surface` from `_config/overrides.md` — a line `review_surface: <value>` in the frontmatter or the body. When the file or the key is absent, the value is `auto`. (Older vaults never received this key in their seeded overrides file, so absence is the normal case.)

| `review_surface` | Surface used |
| --- | --- |
| `auto` (default) | `widget` when this session has an inline-widget tool (a tool whose name ends in `show_widget`); else `server` when the Quartz site answers on `:{{QUARTZ_PORT}}` (check below); else `page`. |
| `widget`, `server`, `page` | That surface. If it is unavailable (no widget tool; site down), fall back to `page` and say so in one line. |
| `artifact` | The artifact surface — and also whenever the user asks for the review as an artifact. Never chosen by `auto`. |

**widget** — for a host that renders inline HTML widgets and gives them `sendPrompt`.

```
python3 scripts/briefing_review.py build <date> --surface widget
```

It prints one path per line: `outputs/briefing-review/<date>.widget.html`, or, when the fragment is larger than the size limit, one file per page (`<date>.widget.1.html`, `<date>.widget.2.html`, …). Read each file and pass its full contents to the widget tool, in the printed order, one widget per file. Do not edit or trim the fragments. Each page submits its own rows: the submit button sends a text export starting `Briefing review — <date>` back into this conversation.

**server** — the Quartz site route, built fresh on every request; there is nothing to build. Confirm the running site has the route (a site from an older engine returns 404):

```
curl -s -o /dev/null -w '%{http_code}' "http://localhost:{{QUARTZ_PORT}}/review/<date>"
```

On `200`, `open "http://localhost:{{QUARTZ_PORT}}/review/<date>"`. On anything else, use `page`. Submitting saves the answers to `Inbox/reviews/<date>.json` directly, and the form autosaves drafts as the user types.

**page** — a self-contained file that works from `file://`:

```
python3 scripts/briefing_review.py build <date>
```

It prints `outputs/briefing-review/<date>.html`; run `open` on that path. Submitting copies a text export to the clipboard for the user to paste into the chat.

**artifact** — only when the user asked for it or set `review_surface: artifact`; it puts briefing content on claude.ai, so it is never the automatic choice.

```
python3 scripts/briefing_review.py build <date> --surface artifact
```

- The default `--redact private` drops `sensitive` items entirely and reduces `private` items to their title, section and pills. Never pass a lower level (`--redact sensitive`) unless the user says so in this conversation; `none` is refused for this surface.
- Read the generated file in full before publishing it. Publishing distributes it, and you must know what it contains.
- Publish it as a **private** artifact with `capabilities: {db: {}, user: {}}`. Never share or pin it unless asked.
- Tell the user how many items were withheld as local-only (the `sensitive` count in the items file) and how many `private` items show only their title.
- The form saves answers to the artifact's database, doc `reviews/<date>` (collection `reviews`, doc id `<date>`). Read them back with the artifact data tool when the user says they are done; [[apply-review]] covers that path.

After opening, tell the user in one line how to switch: "To use a different review surface, set `review_surface: widget | server | page | artifact` in `_config/overrides.md`."

## Step 6 — Report back

```
Briefing generated: Ops/Briefings/<date>.md (opened in browser at http://localhost:{{QUARTZ_PORT}}/Ops/Briefings/<date>).
Review: <N> items, <K> carried from <previous date> — <shown inline above | open at http://localhost:{{QUARTZ_PORT}}/review/<date> | opened outputs/briefing-review/<date>.html | private artifact <link>, <W> items withheld as local-only>. Answer there and submit.
To use a different review surface, set `review_surface: widget | server | page | artifact` in `_config/overrides.md`.

<IF COMMS COVERAGE IS PARTIAL:>
**Comms coverage is partial:** <source/direction> did not scan <range> (<reason>). Absence in that range is inconclusive.

<IF § 0 has items:>
**Confirm these closes** (vault may be lagging reality — from your comms/calendar + a vault scan):
1. [[<item 1>]] — still <status>. <signal, if reconcile-sourced>
2. [[<item 2>]] — ...
They are at the top of the review. If you'd rather answer here, reply with the ones that are done (e.g. "yes to 1,3") and I'll close them.

Top 3 outcomes:
1. <outcome 1>
2. <outcome 2>
3. <outcome 3>

Notable: <one bullet for the most consequential at-risk project or surfaced followup, or "nothing surprising">.
```

Surface any coverage gap at the top of the chat report-back, before §0 confirmations and the Top
3. The user must see when the comms capture is partial; never let a successfully written briefing
make an un-scanned range look complete. Then surface the § 0 items if present — the user reads the
chat before opening the briefing file, and closing stale state in the same session is the whole
point. This is the **single batched confirmation** for everything Step 1b proposed.

**The primary path is the review form.** When answers arrive — a pasted or `sendPrompt` text export
beginning `Briefing review — <date>`, an `Inbox/reviews/<date>.json` file the server surface wrote,
or answers in the review artifact's database — hand off to [[apply-review]]. It saves the answers,
applies them through the owning skills, records each one in the review ledger, and reports. Do not
apply review answers inline in this skill.

**The chat reply stays valid as a fallback.** When the user confirms in chat instead ("yes to 1,3"):

- **Task closes → route through [[close-task]]** (never hand-edit `status: done` — close-task enforces the final `# Work log` entry and the `unblocks:` cascade, and the "agents never self-close" guardrail means this confirmation is what authorizes it).
- **Letter `drafting → submitted`** → the clean two-field edit (`status:` + `submitted:`), per [[reconcile-from-comms]].
- Then **update [[reconcile-from-comms]]'s ledger + checkboxes** for each item so a later standalone reconcile run doesn't re-propose them, and append the `log.md` line(s).

(Tier-A reversible bookkeeping was already applied in Step 1b — don't re-apply it here.)

Don't recapitulate the whole briefing in chat — the file is the artifact.

## What this skill does NOT do

- **Does not silently overwrite.** If today's briefing exists, stop and ask. If it has `## Shutdown notes` appended, refuse the overwrite outright unless the user explicitly says "I know, regenerate and lose the shutdown notes."
- **Does not auto-execute outcomes.** It writes the briefing; the user decides what to actually do.
- **Does not lint.** Lint is a separate weekly task; the briefing surfaces signals but doesn't run check 1–20.
- **Does not modify any of the source notes it reads from.** Projects, Tasks, People, Trackers — all read-only here. Carry-over (Step 2a) only reads the previous review.
- **Does not apply review answers.** It writes the items file and opens the form; [[apply-review]] applies what the user submits. The chat "yes to 1,3" fallback for § 0 closes is the one exception, handled in Step 6.
- **Does not publish the review off the machine on its own.** The artifact surface is used only when the user asks for it or sets `review_surface: artifact`, always as a private artifact, never with `sensitive` items, and never at a lower redaction level than the default unless the user says so.

## Model recommendation

`opus`. The synthesis across ~10 input streams is the whole point; downgrading produces a briefing that reads like a list rather than an operating dashboard. Run on the inherited (Opus) model.

## Related

- `Agents/Prompts/daily-briefing.md` — paste-able prompt equivalent.
- `_workflows/daily-briefing.md` — the canonical procedure.
- `_schemas/briefing.md` — the schema.
- `capture-comms` / `reconcile-from-comms` — Step 1b runs these by default to close loops from enabled email, Slack, Notion, and Jira streams (and calendar if enabled) before synthesis.
- `_config/sources.md` — which streams Step 1b checks; edit it to turn a stream on/off.
- `shutdown-review` — the end-of-day counterpart that appends to this briefing.
- [[apply-review]] — applies the answers submitted in the briefing review (Step 5b) and annotates § 0 with what was resolved.
- `scripts/briefing_review.py` — the review CLI: `validate` (Step 3b), `carryover` (Step 2a), `build` (Step 5b); `save`, `plan`, `mark` and `annotate` belong to apply-review.
- `_config/overrides.md` — `review_surface: auto | widget | server | page | artifact` picks where the review opens (absent = `auto`).
- `Inbox/reviews/` — saved answers (`<date>.json`) and the apply ledger (`<date>.ledger.json`); a system slot, never triaged as a capture.
- `session-start` — the lighter-weight pre-flight (5–10 seconds vs. several minutes here).
- `log-mutation` — the canonical log-append helper.
