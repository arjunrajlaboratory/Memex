---
name: email
description: General-purpose competence for the user's Gmail — search, read, triage, capture-to-vault, and draft replies via the Gmail MCP. Use whenever the user wants to do anything with their email — signaled by phrases like "search my email for ...", "what did X say", "find the thread about ...", "did Y reply yet?", "what's in my inbox", "is there an email from ...", "pull up the thread with ...", "draft a reply to ...", "respond to Z", "what do I owe people over email", or direct invocation "/email". This is the reusable home for *how to use email well* in this vault — the Gmail query cheat-sheet, the search-broadly-first technique (so you don't wrongly conclude "it's not in Gmail"), how to read a full thread, and how to route substantive email into the vault (Source / Person / Task) or draft a reply. It is broader than any single ingest skill: ingest-person uses Gmail only to backfill a CRM note, draft-letter only writes letters — this skill is for arbitrary email work. NEVER sends mail; drafts only (create_draft), per the vault's hard-nos. For pulling ONE substantive thread into the wiki as a Source, this skill hands off to ingest-source; for a new correspondent, to ingest-person.
---

# Use the user's email well

You are running as **`agent:executor`** for this skill (or `agent:capture` when the outcome is a vault note). The job: do whatever the user asked of their email — find it, read it, summarize it, capture it, or draft a reply — using the Gmail MCP correctly.

## Why this skill exists

Gmail is already wired into this vault (the Gmail MCP powers `ingest-person` backfill, `draft-letter` seeding, and `daily-briefing` calendar/inbox pulls). But "how to use email" lived only *inside* those skills. The recurring failure modes were (a) concluding "this isn't in Gmail" after a too-narrow query — a **technique** gap, not a capability gap — and (b) treating a miss in the connected mailbox as proof when the user may have sent from another account the Gmail MCP cannot read. See memories `feedback_gmail_search_technique` and `feedback_gmail_penn_mailbox_blind_spot`. This skill is the general, reusable place for email competence so any session can search/read/capture/draft well without reinventing it.

## Hard rules (non-negotiable)

- **NEVER send email.** No `send`/auto-send. Drafting is allowed *only* via `mcp__claude_ai_Gmail__create_draft`, and only when the user asked for a draft. Tell the user the draft is in Gmail for them to review + send. (Sending is a vault hard-no without explicit per-session opt-in.)
- **Sensitivity.** Email content is `private` by default. Any vault note created from email inherits `sensitivity: private`. Never paste private email bodies into a `normal`/public note.
- **Don't invent.** Quote/paraphrase only what's actually in the thread. If you didn't find it, say so.
- **Log** any vault mutation that results (the capture/Task/Person), via the normal `log.md` discipline (or the child skill does it).

## Step 0 — Load the Gmail tools

The Gmail tools are deferred. Load what you need first:
```
ToolSearch: select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__create_draft
```
(`list_labels` only if you need to resolve a label name → id; `label:` queries take label IDs, not display names.)

## Step 1 — Search broadly first, then narrow

This is the heart of the skill. **Do not start with a single narrow `from:<address>` + `newer_than:` query** — that's exactly how real threads get missed (subject changed mid-thread, the user replied from a different address, the message is older than the window, the person is only cc'd).

Order of operations:
1. **Broad, both directions:** `(from:<name-or-addr> OR to:<name-or-addr>)` with `in:anywhere`, no date filter (or a generous one). Names work as well as address fragments.
2. **Content keywords:** search a distinctive phrase from what you're looking for (`"universal data extraction"`, `"patient navigation"`) — catches threads where the person is only cc'd or the subject is unrelated.
3. **Only then narrow** by date / sender / `is:unread` / `label:` once you've located the thread family.
4. **Only conclude "not in the connected Gmail mailbox"** after a content-keyword search across `in:anywhere` comes up empty. If the thread could live in a non-connected sending account, call that an access gap instead of absence; ask the user to forward/paste it or confirm which account they used.

### Gmail query cheat-sheet (pass as the `query` arg; natural language must be pre-translated)

| Need | Query |
| --- | --- |
| From / to a person | `from:colleague@example.edu`, `to:bob@x.com` |
| Either direction | `(from:X OR to:X)` |
| Everywhere incl. archive/sent | add `in:anywhere` (default search includes archive+sent; use `-in:sent` / `-in:archive` to exclude) |
| Exact phrase | `"clinical trial matching"` |
| Subject | `subject:(EHR extraction)` |
| Time | `newer_than:14d`, `older_than:1y`, `after:2026/05/20`, `before:2026/05/30` |
| Attachments | `has:attachment`, `filename:pdf` |
| Status | `is:unread`, `is:starred`, `is:important` |
| Restrict to inbox | `in:inbox` |
| Group / OR | `{from:amy from:david}` or `from:amy OR from:david` |

Notes: `search_threads` returns snippets + headers only — **not full bodies**. **Mailbox visibility:** the Gmail MCP searches only the connected mailbox, `{{OWNER_PRIMARY_EMAIL}}`{{?OWNER_FORWARDING_EMAIL}}. `{{OWNER_FORWARDING_EMAIL}}` forwards received mail into it, but sent mail from that address is invisible unless it was also sent through the connected mailbox{{/OWNER_FORWARDING_EMAIL}}{{?OWNER_SENDING_ACCOUNTS}}. Other sending accounts the user may use: `{{OWNER_SENDING_ACCOUNTS}}`; mail sent from those accounts is invisible to this Gmail MCP unless those mailboxes are separately connected{{/OWNER_SENDING_ACCOUNTS}}. For threads expected to be in the connected mailbox, assume a **query miss, not an access gap** until broad content-keyword search fails (memory `feedback_gmail_search_technique`). For mail sent from or housed in a non-connected account, an empty search is **inconclusive access-gap evidence**, not proof that the user did not send it.

## Step 2 — Read the actual thread

To get bodies, call `mcp__claude_ai_Gmail__get_thread` with the `threadId` and `messageFormat: FULL_CONTENT`. Read the whole chain (both sides) before summarizing — snippets routinely hide the substance (a "thanks!" snippet can sit on a thread whose body is the actual decision).

## Step 3 — Do what was asked

- **Answer a question** ("what did X say?", "did they reply?") — summarize faithfully with dates; quote the load-bearing lines. Done.
- **Capture substantive content into the vault** — if the thread carries decisions, priorities, or commitments worth keeping, hand off to **`ingest-source`** (it creates `Atlas/Sources/<...>.md` from the email, with a `Raw/sources/<date>-<slug>.md` capture, and updates affected wiki pages). Mirror the pattern of existing email-Sources, e.g. `<person-or-topic> decision summary - <date>`. If the email isn't retrievable from Gmail but the user pasted it, still capture: write the `Raw/sources/` file from the paste with a header comment noting the origin.
- **New correspondent with no Person note** — hand off to **`ingest-person`** (Gmail backfill is automatic there).
- **Action item the email creates** — hand off to **`create-task`** (e.g. "reply by Thursday", "send the data"); or a `Ops/Followups/` tickler if it's a "check whether they replied" nudge.
- **Draft a reply** — see Step 4.

## Step 4 — Drafting a reply (draft only, never send)

When the user asks you to reply/respond:
1. Read the full thread (Step 2) so the draft is in-context.
2. Draft in the user's voice — concise, no AI throat-clearing. For letters specifically, use `draft-letter` instead.
3. Create the draft with `mcp__claude_ai_Gmail__create_draft` (reply on the same thread where possible). **Do not send.**
4. Tell the user: "Draft is in your Gmail on the thread — review and send." Offer to revise.
5. If the reply was itself a tracked obligation, close/advance the matching Task/Followup.

## Step 5 — Calendar adjacency

Scheduling lives next door: if the email is about setting a time, the Calendar MCP (`mcp__claude_ai_Google_Calendar__*`) can check availability / create events — but creating calendar events follows the same authorized-write rules as `create-task` (only on explicit intent). Don't auto-create events from email without the user asking.

## What this skill does NOT do

- **Does not send email.** Ever. Drafts only.
- **Does not write letters** — that's `draft-letter` (letterhead, positioning, Drive delivery).
- **Does not bulk-process the whole inbox into the vault** — for clearing the `Inbox/` *drop zone* (files, not email), that's `triage-inbox`. For one email thread → Source, use this skill → `ingest-source`.
- **Does not lower sensitivity** or paste private bodies into shareable notes.

## Related

- `ingest-source` — turns one substantive email thread into a Source note (+ Raw capture).
- `ingest-person` — new correspondent → Person note (auto Gmail backfill).
- `create-task` / followups — action items an email creates.
- `draft-letter` — letters of rec / cover / nomination (not plain replies).
- `daily-briefing` — already pulls inbox + calendar; this skill is the on-demand counterpart.
- Memories: `feedback_gmail_search_technique` (search broadly first), `feedback_enrich_people_from_gmail` (Person backfill).
