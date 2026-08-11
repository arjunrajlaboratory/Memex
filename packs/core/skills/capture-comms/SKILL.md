---
name: capture-comms
description: >-
  Capture today's mail and Slack activity (whichever of those streams is
  enabled in `_config/sources.md`) into `Inbox/comms/YYYY-MM-DD` as a
  structured digest of summaries, action items, routable threads, and filtered
  noise. Use for "capture today's comms", "daily comms summary", "summarize my
  email and Slack", "what loops did my comms open or close", or
  `/capture-comms`. Read-only against mail and Slack; never sends, drafts,
  reacts, or marks read. This is capture-only phase 1: it proposes targets and
  actions but applies no vault state changes.
---

# capture-comms

Daily capture worker that lands the day's communications in the `Inbox/` drop zone as
structured, triage-ready material. Mirrors the [[cv-scan]] shape (scan an external source,
*propose* only, write to exactly one output area + one `log.md` line) and reuses the [[email]]
skill's broad-search technique.

**The vault's biggest silent-failure mode is state lagging reality** — the user sends an email,
posts a form in Slack, ships a deploy, and the typed note rots at its old status. This skill
*observes* the comms that imply those state changes and stages them. It does **not** apply them.
That's the seam phase 2 consumes (see [[#Phase 2 hook]]).

You are running as **`agent:capture`** for this skill.

## Hard rules (non-negotiable)

- **Capture only — APPLY NOTHING.** Never edit a typed note, close a Task, flip a status, bump
  `last_contact`/`next_touch`, mark a Followup `acted_on`, or touch a Letter. The output is
  staging material in `Inbox/`. All consequential mutation is phase 2 under manual review.
- **Read-only against mail and Slack.** Never `send`, `create_draft`, `slack_send_message`,
  `slack_send_message_draft`, `slack_schedule_message`, `slack_add_reaction`, label, or mark
  read. This skill only searches and reads.
- **Honor sensitivity.** Treat all comms as `private` by default (the output frontmatter says
  so). **Summarize one level up; never paste full message bodies.** For anything that reads as
  HR / legal / medical / personnel / clearly sensitive, summarize at a higher level still and
  flag it as `[sensitive — summarized]` rather than detailing it. The privacy property is
  structural: everything under `Inbox/` is gitignored (`.gitignore`: `Inbox/*`, only
  `Inbox/README.md` is tracked), so these files never enter version control — but that is a
  backstop, not a license to quote.
- **Ruthless on noise.** Most email/Slack is not loop-relevant. Action items are *only* items
  that open or close a vault loop. Everything else is a one-line count in `## Filtered as noise`
  — never a silent cap.
- **No silent caps or truncation.** For every enabled provider stream — including any
  vault-specific Notion or Jira scan — enumerate the whole resolved window with bounded daily
  slices and/or pagination to exhaustion. Never treat the first page as complete. If a scan is
  interrupted, rate-limited, or otherwise stopped early, record the un-scanned range as an
  explicit `coverage gap`; never turn partial coverage into a claim that the period was quiet.
- **No fabrication.** Every action item traces to a real message. If you can't find a likely
  vault target, say `(no obvious target)` — don't invent a note name.
- **Idempotent.** Re-running for the same date regenerates the day's files in place (same path)
  — never creates a second dated file or appends a duplicate digest. See Step 6.

## Output shape (decided + documented)

**One file per enabled capture stream, not one combined file.** The default install has two:

```
Inbox/comms/<YYYY-MM-DD>/email.md
Inbox/comms/<YYYY-MM-DD>/slack.md
# A vault-specific provider scan follows the same shape at <source>.md.
```

Rationale: (1) the mail and Slack connectors are independently authenticated MCP servers with independent
failure modes — if Slack auth is absent in a given run, the email file still lands clean and the
Slack file records the gap, rather than one combined file being half-empty with no signal why;
(2) it mirrors the shape the source idea note specified; (3) each source gets source-appropriate
provenance. Phase 2 globs `Inbox/comms/<date>/*.md` and reads the operational `## Coverage` and
`## Action items` sections from each — the seam is per-section, not per-file, so separate source
files cost it nothing.

Each file carries this frontmatter and these five sections. `## Coverage` is operational data,
not optional commentary: phase 2 and the briefing use it to distinguish a complete capture from
a plausible-looking partial one.

```markdown
---
type: comms-digest
source: email            # or: slack
date: <YYYY-MM-DD>
window_start: <ISO datetime>   # start of the scan window
window_end: <ISO datetime>     # the run time
sensitivity: private           # NEVER lower — these are private comms
generated_by: capture-comms
phase: 1-capture-only          # APPLIES NOTHING; phase 2 reconciles
---

## Coverage
- status: complete             # or: partial
- scanned: <directions, bounded time slices, and page counts actually exhausted>
- coverage gap: none           # or: <direction + un-scanned time range/slice + reason/next cursor>

## Summary
3–6 bullets — the gist of the day's <email|Slack>. What moved, who needs what.

## Action items
<loop-relevant items only — the phase-2 API; see format below>

## Threads worth routing
<things that should become a Source / Person / Task via an existing ingest skill>

## Filtered as noise
<count> messages/threads filtered as non-loop-relevant (newsletters, FYIs, automated, social).
```

### Action item format (the phase-2 API — keep it parseable)

Mirror cv-scan's checkbox + provenance shape (one parseable `↳ key: value` line per field) so phase 2 can parse it deterministically:

```markdown
- [ ] **<one-line description of the loop>**
      ↳ signal: <sent email to Alex / Slack DM I sent to Jordan / received from Riley>  ·  <date/time>
      ↳ thread: <mail thread id for email items (Gmail: `threadId`) — lets phase 2 confirm with a full-thread read without re-searching; `n/a` for Slack>
      ↳ likely target: [[<Task or Person or Letter or Followup>]] (<type>)  — or `(no obvious target)`
      ↳ suggested action: <close task | bump last_contact | flip Letter drafting→submitted | mark Followup acted_on | create task>
      ↳ confidence: high | medium | low
      ↳ apply: NOTHING — phase 2
```

**Sent comms are the strongest loop-*closing* signals** ("I sent the form to Riley in Slack",
"emailed Dana the revised draft") — surface these first and label the signal as sent vs
received. Received comms more often *open* loops (someone asks you for something).

## Steps

0. **Read enabled streams.** Read `_config/sources.md` and look at `streams.*.enabled`.
   Only scan streams marked `enabled: true`. If the file is absent (older vault),
   default to **email + slack enabled** (calendar is not a capture stream — it has its
   own loop-closing path in the briefing; see [[reconcile-from-comms]]). If a stream is
   disabled, skip its scan entirely and don't write that source's file. This is the
   per-stream gate the default daily-briefing flow relies on. **Ignore stale digests from
   disabled sources.** Do not delete an existing same-day file when its source is disabled — it
   may carry hand annotations or a reconciliation ledger — but every downstream consumer must
   exclude that file by its `source:` frontmatter (falling back to the filename stem for legacy
   digests) before parsing it.

1. **Resolve the date + scan window.** Date is today (or the date argument if given). Find the
   most recent prior `Inbox/comms/<date>/` folder to get the last run time; the window is
   (last run → now). If there's no prior run, default to the **last 36 hours** (overlap is safe
   — dedupe handles it; missing a loop is worse than re-listing one). Record `window_start` /
   `window_end` in frontmatter.

2. **Load the MCP tools** (they're deferred). Resolve the mail server id from
   `streams.email.mcp` in `_config/sources.md`, then one ToolSearch per source:
   ```
   ToolSearch: +<mail-server-id> search thread     (Gmail example: select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread)
   ToolSearch: select:mcp__claude_ai_Slack__slack_search_public_and_private,mcp__claude_ai_Slack__slack_read_channel,mcp__claude_ai_Slack__slack_read_thread,mcp__claude_ai_Slack__slack_read_user_profile,mcp__claude_ai_Slack__slack_search_users
   ```
   If either server is unavailable (interactive auth absent — a documented caveat for
   headless/cron runs), **do not fail the whole run**: write that source's standard digest with
   `status: partial`, a `coverage gap` naming the full un-scanned window, and a
   `> ⚠️ <source> unavailable this run (auth/connection)` note at the top. Then proceed with the
   other source. This is exactly the partial-failure case the two-file split exists to handle.

3. **Scan mail — both directions** (only if `email` is enabled per Step 0). Use the [[email]] broad-search technique (don't start
   narrow; on Microsoft 365 use the connector's own search parameters, not Gmail operators). Cover sent AND received in the window:
   - Received: the inbox in each bounded window/slice (Gmail: `in:inbox` plus the slice bounds),
     plus a wider `in:anywhere` pass for threads that skip the inbox.
   - **Sent mail in each bounded window/slice** (Gmail: `in:sent` plus the slice bounds) — the
     loop-closing gold. What did *I* send?
   - **Enumerate the full window, not just the newest page.** When the window exceeds 2 days,
     split each received and sent search into bounded, non-overlapping **calendar-day slices** in
     the vault timezone. Use the provider's explicit start/end parameters where available. For
     Gmail date operators, widen the query boundaries enough to absorb their date semantics, then
     discard messages outside the exact slice by timestamp. Within every slice — and for shorter
     windows too — follow `nextPageToken`, `cursor`, or the provider's equivalent until it is
     absent. Search results may be newest-first and capped: **never treat the first page as
     complete coverage**. After pagination, build one global `threadId` map across all calendar-day slices and query variants
     (`in:inbox`, `in:anywhere`, and `in:sent`), including every page and sent/received
     direction.
     Merge repeated hits into the existing entry, preserving
     direction, exact slice bounds, timestamps, and query provenance. Only after every planned
     search is enumerated, read each unique thread with `get_thread` and classify it once.
   - Track the direction, exact slice bounds, and pages exhausted for `## Coverage`. If any query
     stops before pagination is exhausted, mark the file `status: partial` and name the remaining
     un-scanned slice/range and next cursor in `coverage gap`. A completed pagination walk means
     only that the connector's returned result set was enumerated; it does not prove a stale index
     is fresh or that a different mailbox was visible.
   - For any unique thread that looks loop-relevant, use the global entry's one `get_thread` read
     with `messageFormat: FULL_CONTENT` to inspect the actual chain before classifying (snippets
     hide the substance). Record that thread's
     `threadId` in the action item's `↳ thread:` field so phase-2 reconcile can re-confirm via
     `get_thread` without re-searching a possibly-stale index.
   - Mailbox visibility: the mail connector searches only the connected mailbox, `{{OWNER_PRIMARY_EMAIL}}`{{?OWNER_FORWARDING_EMAIL}}.
     `{{OWNER_FORWARDING_EMAIL}}` forwards received mail into it, but sent mail from that address
     is invisible unless it was also sent through the connected mailbox{{/OWNER_FORWARDING_EMAIL}}{{?OWNER_SENDING_ACCOUNTS}}.
     Other sending accounts the user may use: `{{OWNER_SENDING_ACCOUNTS}}`; the connector's sent-mail view cannot see
     mail sent from those accounts unless their mailboxes are separately connected{{/OWNER_SENDING_ACCOUNTS}}.
     For threads expected in the connected mailbox, a miss is usually a query miss (memory
     `feedback_gmail_search_technique`). For sends from non-connected accounts, an empty `in:sent`
     result is an access gap and must be labeled **couldn't confirm**, not "not sent" or
     "awaiting send."
   - **`search_threads` can be stale — separate from visibility.** The search index can sit days
     behind reality even for the connected mailbox, and re-running the same query does not refresh
     it. So an empty sent-mail search is never proof a send didn't happen, even when no other account is in
     play: confirm a specific thread's latest state with a full-thread read (Gmail: `get_thread(threadId)` — live ground truth),
     and label any unconfirmed send **couldn't confirm** — never "not sent" / "awaiting send." If the
     user says they sent it, believe them and capture the loop accordingly (memory
     `feedback_gmail_mcp_stale_reads`).

4. **Scan Slack — both directions, including what I sent** (only if `slack` is enabled per Step 0).
   - Resolve the user's own Slack identity first (`slack_read_user_profile` /
     `slack_search_users`) so you can recognize `from:<me>`.
   - When the window exceeds 2 days, split both searches below into bounded calendar-day slices
     using explicit epoch `after`/`before` parameters (with local timestamp filtering at the
     boundaries). Paginate every slice to exhaustion. Record each slice and page count in
     `## Coverage`; if a slice is cut short, mark the digest partial and record its un-scanned
     remainder and next cursor as a `coverage gap`.
   - Search messages **I sent** in the window (`slack_search_public_and_private` filtered to the
     user as author) — "I sent the form to Riley", "shipped the deploy", "replied to the review"
     are the strongest close signals.
   - Search messages/threads **directed at me** (mentions, DMs, threads I'm in) in the window.
   - For a loop-relevant hit, `slack_read_thread` / `slack_read_channel` to read enough context
     to classify — then summarize; never paste the raw thread.

   > ### ⚠️ Slack search is a DISCOVERY tool, not a COVERAGE tool
   >
   > The author-search above tells you *which conversations were active*. It is **not** evidence of
   > what was said, and an absence in it is **never** evidence that nothing happened. Two
   > independent defects make a search-only sweep silently under-report — both observed on a single
   > run that returned **3 messages for a 22-hour window that actually held ~30**, and consequently
   > reported a task's "tell the reporter" criterion as unmet when the message had in fact been sent:
   >
   > 1. **`after:YYYY-MM-DD` is EXCLUSIVE of the named date.** `after:<date>` returns only
   >    `<date>+1` onward — it drops *all* of `<date>`. Verified by A/B on the same workspace:
   >    `after:2026-08-03` → 3 hits; `after:2026-08-02` → 20+ hits spanning 08-03. **Always pass
   >    `after:<window_start date − 1 day>`** and discard anything genuinely before `window_start`
   >    yourself. Same trap for `before:`. Prefer the epoch `after:`/`before:` *parameters* (not the
   >    query operators) when you need real precision.
   > 2. **The result cap is per-request and one chatty thread saturates it.** `limit` maxes at 20.
   >    On the corrective re-sweep, **17 of 20 results were a single DM debugging session** — every
   >    other conversation was evicted. Short, high-value messages ("this should be fixed now!") are
   >    exactly what gets pushed out. **Always paginate via `cursor` until exhausted**, and pass
   >    `include_context: false` so context blocks don't eat the budget.
   >
   > **Required completeness step.** Treat the search only as a way to enumerate *conversation IDs*.
   > Then, for **every distinct channel/DM ID it surfaced**, call `slack_read_channel` with explicit
   > epoch `oldest`/`latest` bounds. `slack_read_channel` is exhaustive within its bounds; search is
   > not. If a conversation's only activity fell on a date the buggy operator excluded, *no* amount
   > of re-running the search will reveal it.
   >
   > **Non-negotiable:** never write "no DMs from anyone besides X", "→ quiet", or any other
   > completeness claim on the strength of a search result alone. Those sentences require a
   > `slack_read_channel` read.

5. **Classify every surviving item into exactly one bucket:**
   - **Action item** — opens or closes a vault loop. Extract per the format above; do the
     best-effort match to an existing vault note (search `Ops/Tasks/`, `Atlas/People/`,
     `Atlas/Letters/`, `Ops/Followups/` by person name + subject keyword, the way
     `observe-task-actuals` triangulates) and name the *likely* target — but apply nothing.
   - **Thread worth routing** — substantive content that should become a typed note: name the
     handoff skill (`ingest-source` for a decision/discussion thread, `ingest-person` for a new
     correspondent, `create-task` for a concrete new action).
   - **Noise** — everything else. Count it; one line in `## Filtered as noise`.

6. **Write the per-source files (idempotent).** First, run the **completeness self-check for every
   enabled source or stream**. Retry a recoverable gap before writing; if auth, rate limits, tool
   failure, or time prevents completion, still write the digest as partial rather than losing the
   successfully captured material:
   1. Is there a coverage plan for every direction/query, with bounded calendar-day slices for a
      window over 2 days? Were all planned slices attempted?
   2. Was every slice **paginated to exhaustion**? A capped first page is not coverage. If not,
      does `## Coverage` say `status: partial` and identify the direction, un-scanned time
      range/slice, reason, and next cursor/token (when one exists) as a `coverage gap`?
   3. For Slack, did the author-search use `after:<window_start date − 1 day>` rather than the
      window's own date, and did `slack_read_channel` cover every distinct conversation ID the
      search surfaced? If not, retry Step 4 or record the exact unscanned remainder as a gap.
   4. Does the digest contain any completeness claim — "quiet", "no DMs besides X", "nothing from
      Y" — resting on a search result or a partial scan? Verify it with the source read or delete it.
   5. Sanity-check the magnitude against the window length and this user's activity. **Three
      messages for a workday is a bug, not a quiet day.** An implausible count requires another
      pass or an explicit coverage gap; nothing inside a truncated digest looks wrong by itself.

   Apply the same self-check to any additional enabled provider scan supplied by the vault (for
   example Notion or Jira): bounded slices or cursor exhaustion, never a first-page assumption,
   and an explicit un-scanned remainder whenever coverage is partial.

   Then: `mkdir -p Inbox/comms/<date>` once. For each source: if
   the file already exists, **Read it first**; if it looks hand-edited or annotated below the
   generated sections, preserve that content and regenerate above a clear
   `<!-- regenerated <datetime> -->` marker rather than clobbering. Otherwise overwrite in place
   (the file is a derived view of the day's comms — a re-run reflects the latest state). Never
   write a second dated file or a duplicate digest.

7. **Log once.** Append one line to `log.md`:
   ```
   <datetime> — agent:capture — capture — Inbox/comms/<date>/ — capture-comms: <A> action items (email <E>, slack <S>), <R> to route, <F> filtered
   ```

## Phase 2 hook

This skill is the **capture half** of the [[Daily comms digest and automated loop-closing]]
idea. Phase 2 — a *separate* `reconcile-from-comms` skill (propose-only, manual review, modeled
on the daily-briefing §0 "State confirmation needed" pre-flight) — is the half that mutates
vault state.

**The handoff contract has two operational sections: `## Coverage` and `## Action items`.** Phase 2:
1. Reads the enabled capture streams from `_config/sources.md`, then globs
   `Inbox/comms/<date>/*.md`. **Ignore stale digests from disabled sources:** exclude the whole
   file before parsing either `## Coverage` or `## Action items`, using `source:` frontmatter and
   the filename stem as the legacy fallback. This preserves the file on disk without letting its
   old coverage or action items affect the current run.
2. Parses `## Coverage` from the remaining enabled-source files first. It carries any partial
   source, direction, and un-scanned range forward as inconclusive rather than negative evidence.
3. Parses each `## Action items` block (the checkbox + `↳` format above is the item schema).
4. For each item, resolves `likely target` to a real note and proposes the `suggested action`
   (close Task, flip Letter `drafting→submitted`, bump Person `last_contact`/`next_touch`, mark
   Followup `acted_on`).
5. Auto-applies only the trivial/reversible ones (bump `last_contact`, mark a Followup); surfaces
   the consequential/irreversible ones (close a p1 Task, flip a Letter to submitted, anything
   needing a final Work-log narrative) for explicit user confirmation before applying.

Phase 1 (this skill) **never** does step 2 or 3. It only produces step 1's input.

## What this skill never does

- Edit any typed note; close/advance any Task; flip any status; bump `last_contact`/`next_touch`;
  mark a Followup `acted_on`; touch a Letter. (All phase 2.)
- Send / draft / react-to / schedule / mark-read any email or Slack message.
- Quote full private message bodies, or detail sensitive (HR/legal/medical) content.
- Lower a note's sensitivity, or write anything outside `Inbox/comms/<date>/` + one `log.md` line.
- Create Person/Source/Task notes — it *proposes* them in `## Threads worth routing` for the
  named ingest skill to create.

## Related

- `_config/sources.md` — the per-stream enable/disable config this skill reads in Step 0.
- [[cv-scan]] — the propose-only-from-mail pattern this mirrors.
- [[email]] — the broad-search technique + Gmail query cheat-sheet this reuses.
- [[triage-inbox]] — consumes `Inbox/` items, including the `## Threads worth routing` entries.
- `Daily comms digest and automated loop-closing` (idea) — full design rationale + phase 2 spec.
- Memories: `feedback_gmail_search_technique` (search broadly first), `feedback_gmail_mcp_stale_reads` (search index can lag reality — confirm with `get_thread`).
