---
name: capture-comms
description: Pull the day's Gmail (sent + received) and Slack (sent + received) into a dated Inbox subfolder as a structured digest — Summary, ruthlessly-extracted Action items, Threads worth routing, and a Filtered-as-noise count — so triage and a later reconciliation pass can act on it. Use whenever the user wants today's communications captured into the vault — signaled by phrases like "capture today's comms", "daily comms summary", "summarize my email and slack", "what loops did my comms open or close today", "pull my comms into the inbox", or direct invocation "/capture-comms". Read-only against Gmail and Slack (NEVER sends, drafts, reacts, or marks read). Writes ONLY Inbox/comms/<date>/ files and one log.md line. This is PHASE 1 (capture only): it proposes likely vault targets and suggested actions but APPLIES NOTHING — closing tasks, flipping statuses, and bumping last_contact are phase 2 (a separate reconciliation skill).
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
- **Read-only against Gmail and Slack.** Never `send`, `create_draft`, `slack_send_message`,
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
- **No fabrication.** Every action item traces to a real message. If you can't find a likely
  vault target, say `(no obvious target)` — don't invent a note name.
- **Idempotent.** Re-running for the same date regenerates the day's files in place (same path)
  — never creates a second dated file or appends a duplicate digest. See Step 6.

## Output shape (decided + documented)

**Two files per day, not one combined file:**

```
Inbox/comms/<YYYY-MM-DD>/email.md
Inbox/comms/<YYYY-MM-DD>/slack.md
```

Rationale: (1) Gmail and Slack are independently authenticated MCP servers with independent
failure modes — if Slack auth is absent in a given run, the Gmail file still lands clean and the
Slack file records the gap, rather than one combined file being half-empty with no signal why;
(2) it mirrors the shape the source idea note specified; (3) each source gets source-appropriate
provenance. Phase 2 globs `Inbox/comms/<date>/*.md` and reads the `## Action items` section from
both — the seam is per-section, not per-file, so two files cost it nothing.

Each file carries this frontmatter and these four sections:

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

Mirror cv-scan's checkbox + provenance block exactly, so phase 2 can parse it deterministically:

```markdown
- [ ] **<one-line description of the loop>**
      ↳ signal: <sent email to Alex / Slack DM I sent to Jordan / received from Riley>  ·  <date/time>
      ↳ thread: <Gmail `threadId` for email items — lets phase 2 confirm via `get_thread` without re-searching; `n/a` for Slack>
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
   per-stream gate the default daily-briefing flow relies on.

1. **Resolve the date + scan window.** Date is today (or the date argument if given). Find the
   most recent prior `Inbox/comms/<date>/` folder to get the last run time; the window is
   (last run → now). If there's no prior run, default to the **last 36 hours** (overlap is safe
   — dedupe handles it; missing a loop is worse than re-listing one). Record `window_start` /
   `window_end` in frontmatter.

2. **Load the MCP tools** (they're deferred). One ToolSearch each:
   ```
   ToolSearch: select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread
   ToolSearch: select:mcp__claude_ai_Slack__slack_search_public_and_private,mcp__claude_ai_Slack__slack_read_channel,mcp__claude_ai_Slack__slack_read_thread,mcp__claude_ai_Slack__slack_read_user_profile,mcp__claude_ai_Slack__slack_search_users
   ```
   If either server is unavailable (interactive auth absent — a documented caveat for
   headless/cron runs), **do not fail the whole run**: write that source's file with an empty
   body and a `> ⚠️ <source> unavailable this run (auth/connection)` note at the top, and
   proceed with the other source. This is exactly the partial-failure case the two-file split
   exists to handle.

3. **Scan Gmail — both directions** (only if `email` is enabled per Step 0). Use the [[email]] broad-search technique (don't start
   narrow). Cover sent AND received in the window:
   - Received: `in:inbox newer_than:<window>` (and a wider `in:anywhere newer_than:<window>` for
     threads that skip the inbox).
   - **Sent: `in:sent newer_than:<window>`** — the loop-closing gold. What did *I* send today?
   - For any thread that looks loop-relevant, `get_thread` with `messageFormat: FULL_CONTENT` to
     read the actual chain before classifying (snippets hide the substance). Record that thread's
     `threadId` in the action item's `↳ thread:` field so phase-2 reconcile can re-confirm via
     `get_thread` without re-searching a possibly-stale index.
   - Mailbox visibility: the Gmail MCP searches only the connected mailbox, `{{OWNER_PRIMARY_EMAIL}}`{{?OWNER_FORWARDING_EMAIL}}.
     `{{OWNER_FORWARDING_EMAIL}}` forwards received mail into it, but sent mail from that address
     is invisible unless it was also sent through the connected mailbox{{/OWNER_FORWARDING_EMAIL}}{{?OWNER_SENDING_ACCOUNTS}}.
     Other sending accounts the user may use: `{{OWNER_SENDING_ACCOUNTS}}`; `in:sent` cannot see
     mail sent from those accounts unless their mailboxes are separately connected{{/OWNER_SENDING_ACCOUNTS}}.
     For threads expected in the connected mailbox, a miss is usually a query miss (memory
     `feedback_gmail_search_technique`). For sends from non-connected accounts, an empty `in:sent`
     result is an access gap and must be labeled **couldn't confirm**, not "not sent" or
     "awaiting send."
   - **`search_threads` can be stale — separate from visibility.** The search index can sit days
     behind reality even for the connected mailbox, and re-running the same query does not refresh
     it. So an empty `in:sent` is never proof a send didn't happen, even when no other account is in
     play: confirm a specific thread's latest state with `get_thread(threadId)` (live ground truth),
     and label any unconfirmed send **couldn't confirm** — never "not sent" / "awaiting send." If the
     user says they sent it, believe them and capture the loop accordingly (memory
     `feedback_gmail_mcp_stale_reads`).

4. **Scan Slack — both directions, including what I sent** (only if `slack` is enabled per Step 0).
   - Resolve the user's own Slack identity first (`slack_read_user_profile` /
     `slack_search_users`) so you can recognize `from:<me>`.
   - Search messages **I sent** in the window (`slack_search_public_and_private` filtered to the
     user as author) — "I sent the form to Riley", "shipped the deploy", "replied to the review"
     are the strongest close signals.
   - Search messages/threads **directed at me** (mentions, DMs, threads I'm in) in the window.
   - For a loop-relevant hit, `slack_read_thread` / `slack_read_channel` to read enough context
     to classify — then summarize; never paste the raw thread.

5. **Classify every surviving item into exactly one bucket:**
   - **Action item** — opens or closes a vault loop. Extract per the format above; do the
     best-effort match to an existing vault note (search `Ops/Tasks/`, `Atlas/People/`,
     `Atlas/Letters/`, `Ops/Followups/` by person name + subject keyword, the way
     `observe-task-actuals` triangulates) and name the *likely* target — but apply nothing.
   - **Thread worth routing** — substantive content that should become a typed note: name the
     handoff skill (`ingest-source` for a decision/discussion thread, `ingest-person` for a new
     correspondent, `create-task` for a concrete new action).
   - **Noise** — everything else. Count it; one line in `## Filtered as noise`.

6. **Write the two files (idempotent).** `mkdir -p Inbox/comms/<date>` once. For each source: if
   the file already exists, **Read it first**; if it looks hand-edited or annotated below the
   generated sections, preserve that content and regenerate above a clear
   `<!-- regenerated <datetime> -->` marker rather than clobbering. Otherwise overwrite in place
   (the file is a derived view of the day's comms — a re-run reflects the latest state). Never
   write a second dated file or a duplicate digest.

7. **Log once.** Append one line to `log.md`:
   ```
   <datetime> — actor:me — capture — Inbox/comms/<date>/ — capture-comms: <A> action items (email <E>, slack <S>), <R> to route, <F> filtered
   ```

## Phase 2 hook

This skill is the **capture half** of the [[Daily comms digest and automated loop-closing]]
idea. Phase 2 — a *separate* `reconcile-from-comms` skill (propose-only, manual review, modeled
on the daily-briefing §0 "State confirmation needed" pre-flight) — is the half that mutates
vault state.

**The handoff contract is the `## Action items` section.** Phase 2:
1. Globs `Inbox/comms/<date>/*.md`, parses each `## Action items` block (the checkbox + `↳`
   format above is the schema).
2. For each item, resolves `likely target` to a real note and proposes the `suggested action`
   (close Task, flip Letter `drafting→submitted`, bump Person `last_contact`/`next_touch`, mark
   Followup `acted_on`).
3. Auto-applies only the trivial/reversible ones (bump `last_contact`, mark a Followup); surfaces
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
- [[cv-scan]] — the propose-only-from-Gmail pattern this mirrors.
- [[email]] — the broad-search technique + Gmail query cheat-sheet this reuses.
- [[triage-inbox]] — consumes `Inbox/` items, including the `## Threads worth routing` entries.
- `Daily comms digest and automated loop-closing` (idea) — full design rationale + phase 2 spec.
- Memories: `feedback_gmail_search_technique` (search broadly first), `feedback_gmail_mcp_stale_reads` (search index can lag reality — confirm with `get_thread`).
