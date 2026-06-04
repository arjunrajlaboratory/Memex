---
name: triage-inbox
description: Triage every unfiled capture in Inbox/ — one-by-one classification (source/task/decision/interaction/commitment/ask/followup/journal/draft-wiki) routed to the right typed note via the matching skill, with archives. Use whenever the user wants to clear unprocessed captures from the vault's drop zone — signaled by phrases like "triage the inbox", "process the inbox", "clear out Inbox/", "what's in the inbox", "let's process those captures", "I dropped some files for you", "ingest everything in Inbox/", or direct invocation "/triage-inbox". Walks every unfiled item in `Inbox/` (the gitignored drop zone) one at a time. For each: classifies (source, task, decision, interaction, commitment, ask, followup, journal, draft-wiki), routes to the right typed note via the appropriate skill (`ingest-source` for articles, `ingest-person` for new people, inline write for tasks/decisions/etc.), moves the original to `Inbox/_filed/<today>/`, and logs the mutation. The signal of completion is an empty top-level `Inbox/` (only `README.md` and `_filed/` remain). Use this skill at the start of a session when captures have accumulated; it is the inverse of "where did we leave off."
---

# Triage the inbox

You are running as **`agent:capture`** for the duration of this skill. Your job: take every unfiled item in `Inbox/` and route it to the right typed note, archive the original, and log. The user wants the inbox empty by the end.

## Why this skill exists

Captures pile up. The `Inbox/` drop zone fills with PDFs, screenshots, pasted text, draft notes, voice notes. Without triage, the value is locked away — the vault can't surface what's not yet been classified.

This skill is the antidote to the failure mode where dropped material sits unfiled for a week, the user loses context, and the original "I should remember this" intent is lost. Process items **today**.

It also enforces the routing contract from `CLAUDE.md`: binaries → `Raw/` (tracked) before the typed output is written, then originals move to `Inbox/_filed/<today>/`.

## Inputs

None required. The skill discovers its own work by listing `Inbox/`.

Optional: the user may say "just the PDFs" or "skip the screenshots, only do the markdown" — honor a scope hint.

## Step 0 — Orient

Read these before doing anything:

- `_schemas/_types.md` (so you know every type you might route to)
- The last ~10 lines of `log.md` (to avoid duplicates and re-create context)
- Skim `Inbox/_filed/<today>/` to see if a previous run already happened today

List the queue:

- `ls Inbox/` (excluding `README.md` and `_filed/`)

If empty, report "inbox clean" and exit. Don't invent work.

## Step 1 — Set up the archive folder

```bash
mkdir -p Inbox/_filed/<today>
```

Run this once at the start of the run so subsequent moves don't fail.

## Step 2 — Process items one at a time

For each item, follow the routing decision tree below. **Do not batch-process** — every item gets its own moment of judgment, because routing wrong is worse than processing slowly.

### Decision tree (in order, first-match wins)

1. **Binary file (pdf, docx, png, jpg, mp3, mp4, csv, xlsx, etc.) in `Inbox/`** → COPY into `Raw/<subfolder>/<YYYY-MM-DD>-<slug>.<ext>` (tracked). The subfolder is `sources/` for articles/papers, `screenshots/` for images, `transcripts/` for audio, etc. Then invoke `/ingest-source` to create the typed Source note. After the Source note is in place, MOVE the original from `Inbox/<file>` → `Inbox/_filed/<today>/<file>`.

2. **Markdown / plain-text file in `Inbox/` that's a *raw capture*** (pasted article, transcript chunk, snippet from a chat) → COPY content into `Raw/sources/<YYYY-MM-DD>-<slug>.md` with a header comment recording the original `Inbox/` filename + capture date. Invoke `/ingest-source` on it. MOVE original to `Inbox/_filed/<today>/`.

3. **Markdown / plain-text file in `Inbox/` that's *synthesized wiki content*** (a draft Concept page, draft Project, finished decision) → reconcile frontmatter against `_schemas/<type>.md`, create `Atlas/<Type>/<Display Name>.md` directly, and MOVE original to `Inbox/_filed/<today>/`.

4. **Audio capture / voice memo in `Inbox/`** → transcribe if needed, then route based on content (often a Task, a Journal entry, or a quick Interaction). After routing, MOVE original to `Inbox/_filed/<today>/`.

5. **Anything else in `Inbox/`** → classify per the table below, route, MOVE to `Inbox/_filed/<today>/`.

### Classification table

| Capture shape | Type | Skill / inline action |
| --- | --- | --- |
| Article / paper / URL / PDF | `source` | `/ingest-source` |
| "Need to do X by Y" | `task` | Invoke `/create-task` — it handles the sequential ID, schema check, parent project pick, optional calendar block (if the capture includes a time), and the log line. Pass the subject + any time-block / due hints from the capture. |
| "I decided to do X because Y" | `decision` | Invoke `/capture-decision` — it handles the schema, the parent backlink, and supersede chaining if the decision overrides a prior one. |
| "Met with / talked to / called X about Y" | `interaction` | Write `Atlas/People/Interactions/<Date> - <Person>.md`. Default `sensitivity: private`. |
| "I promised X to do Y" / "X promised to do Y for me" | `commitment` | Write `Atlas/People/Commitments/<Subject>.md`. Default `sensitivity: private`. |
| "I want to ask X about Y" / "I should approach X for Y" | `ask` | Write `Atlas/People/Asks/<Subject>.md`. Default `sensitivity: private`. |
| "Remember to do X on date D" | `followup` | Write `Ops/Followups/<Subject> - <due-date>.md`. |
| Reflective entry, daily-journal-shaped | `journal` | Append to `Ops/Journal/<date>.md` (or `Inbox/_journal/<date>.md` if you're following the legacy schema path — see `_schemas/journal.md`). |
| Draft wiki page (Concept / Project / etc.) | `<type>` | Write directly to `Atlas/<Type>/...` after schema reconciliation. |
| New person mentioned, no existing Person note | `person` | Invoke `/ingest-person` (Gmail backfill is mandatory per standing user pref). |

### Search-before-write

Before creating a new typed note, **search the vault for an existing note it might attach to**. Prefer linking or updating an existing note over creating a parallel one. Run a quick grep for the subject's key phrase.

### Per-item logging

After each item is routed, append one line to `log.md`:

```
<datetime> — agent:capture — triage — [[<note-name>]] — <one-sentence summary>
```

## Step 3 — When you cannot classify

If an item is genuinely ambiguous after a real attempt, leave it at the top level of `Inbox/` (do NOT move into `_filed/`) and write a Followup in `Ops/Followups/` describing what's unclear. The unclassified-but-flagged signal is more useful than a wrong classification.

## Step 4 — Privacy rules

- Read `_schemas/_privacy.md` before writing any People-related note.
- Default `sensitivity: private` for `interaction`, `commitment`, `ask`.
- Never lower a note's sensitivity without explicit user instruction (this is a hard no per `CLAUDE.md`).

## Step 5 — Summary

When the queue is empty (or you've routed everything you can):

```
Triage complete.
- Inbox/ top level: <empty | N items left, all flagged with followups>

Items processed: <N>
- Sources: <N>
- Tasks: <N>
- Interactions / Commitments / Asks: <N>
- Followups: <N>
- Wiki drafts promoted: <N>
- People (new): <N>  (invoked /ingest-person for each)

Notable:
- <one bullet for the most consequential item, if any>
```

## What this skill does NOT do

- **Does not over-triage.** When in doubt, leave at the top of `Inbox/` and write a Followup; that's better than forcing a wrong type.
- **Does not lower sensitivity.** Default `private` for People-adjacent items.
- **Does not modify `Raw/` after copying.** The raw is immutable.
- **Does not skip the `_filed/` move.** An item processed but left in `Inbox/` top level is a false negative — it'll look unfiled on the next session-start.

## Model recommendation

Inherit `opus` for the orchestrator. Classification + judgment is the bottleneck. For very large raw extracts (a 50-page PDF), dispatch a `sonnet` or `haiku` sub-agent to extract claims before you classify — but this is the exception.

## Related

- `Agents/Prompts/triage-inbox.md` — paste-able prompt equivalent (use outside Claude Code).
- `_workflows/capture-triage.md` — the full long-form workflow.
- `ingest-source`, `ingest-person`, `ingest-project` — sibling skills invoked from inside this one.
- `create-task` — invoked for any Task-shaped capture (a time-blocked capture also gets a Google Calendar event via that skill).
- `capture-decision` — invoked for any Decision-shaped capture.
- `session-start` — when run as part of a session-start, it often surfaces "you have N unfiled items" before this skill is invoked.
