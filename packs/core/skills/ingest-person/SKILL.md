---
name: ingest-person
description: Create a vault Person note with Gmail backfill of email, last_contact, role, organization, and seeded conversation history. Use whenever a new Person needs a profile in the Memex vault — signaled by phrases like "add a Person for X", "create a Person note for Y", "I just met Z and want to track them", "set up a CRM entry for ...", or implicitly whenever another skill (ingest-project, triage-inbox, ingest-source) introduces a person who doesn't already have a `Atlas/People/<Name>.md`. This skill always searches Gmail for prior threads with the person and backfills email, last_contact, role inferred from signatures, organization, and a seeded `# Conversation history` section before writing — that Gmail backfill is a standing user preference (see memory `feedback_enrich_people_from_gmail`) and is the main reason this exists as a dedicated skill rather than inline note-writing. Use it even for one-off Person creation; the backfill catches "wait, I've been emailing this person for two years" 80% of the time.
---

# Ingest a Person into the vault

You are running as **`agent:librarian`** for this skill. Your job is to write **one** Person note at `Atlas/People/<Display Name>.md`, with the Gmail backfill move always applied before the write.

## Why this skill exists

The user's standing preference (memory `feedback_enrich_people_from_gmail`): "when creating a Person note, search Gmail and backfill email, last_contact, role, and conversation history." Writing a Person note without that backfill leaves a stub that's worse than no note at all, because future workflows assume Person notes are real CRM entries. This skill enforces the backfill.

## Inputs

The caller (you, or a parent skill like `ingest-project`) should supply:

- **Display name** (required) — full name, e.g., "Jordan Lee".
- **Context** (recommended) — one or two sentences on why this Person is being added. "Example U collaborator on the clinical trials project" beats "a researcher".
- **Email hint** (optional) — if the user already knows the address, pass it. If not, you'll discover it in Step 1.
- **Likely organization** (optional) — speeds up Gmail filtering.
- **Sensitivity** (optional) — defaults to `private`. Override only on explicit user instruction.

If any of the above are missing and the calling context can't supply them, ask the user before proceeding. Don't fabricate.

## Step 0 — Read the schema and the privacy rules

Read in full:

- `_schemas/person.md`
- `_schemas/_privacy.md`

Both are short. Don't skip — the schema's defaults change occasionally and the privacy rules are non-negotiable.

## Step 1 — Search Gmail and backfill

Use the Gmail tools (`mcp__claude_ai_Gmail__search_threads`, `mcp__claude_ai_Gmail__get_thread`) to find prior correspondence.

**Search strategy** — issue several queries in parallel:

```
from:"<Display Name>"
to:"<Display Name>"
"<Display Name>"            (full-text fallback)
from:<email-hint>            (if email_hint provided)
```

If the Person has a likely org, also try `"<Display Name>" <org-domain>` to disambiguate from unrelated namesakes.

**Token discipline** — Gmail threads can be long. Default to:

- `list_threads` / `search_threads` first (cheap, returns thread IDs + subjects + snippets).
- Pull full thread bodies only for the **3 most recent threads** and the **earliest thread** (to date the relationship). Skip middle threads unless something material happens.
- For thread-body extraction, dispatch a Haiku sub-agent with the threads as input — Haiku is plenty for "read these emails and tell me their email address, signature/role, and what topics they discuss".

**Extract these fields** from the threads:

- `email:` — most consistent address they send from
- `last_contact:` — date of the most recent thread you found
- `role:` and `organization:` — from signature lines or "I'm <name>, <role> at <org>" intros
- `linkedin:`, `phone:`, `website:` — if present in signatures
- `timezone:` and `location:` — if mentioned or inferable from a calendar invite
- Concepts discussed → candidates for `can_help_with:` and `active_threads:`
- 3–5 most-recent threads → seed `# Conversation history` bullets, one per thread, dated, with a one-line summary and a thread-ID reference if possible

If you find **zero threads**, that's fine — note it in the body ("# Conversation history" gets a single bullet: `- <today> — no prior Gmail correspondence found`). Don't invent.

## Step 2 — Search the vault for related entities

Before writing, check:

- Does an `Organization - <Org>` note already exist? If yes, use the wikilink. If no, **note it as a recommendation** in your final report — don't auto-create org notes from a Person ingest unless the user asked you to. (`ingest-project` handles org creation explicitly; standalone Person creation doesn't.)
- Are there existing `Concept - <X>` pages that match what the Person can help with? Link them in `can_help_with:`.
- Is there an existing `Project - <Y>` page where this Person belongs in `people:`? **Don't edit the Project page** — surface that as a suggestion at the end so the user can decide.

## Step 3 — Write the Person note

Path: `Atlas/People/<Display Name>.md` — run `<Display Name>` through `safe_title` first (see `CLAUDE.md`/`AGENTS.md` → "A note's title IS its filename"): ` / ` → ` and ` (bare `/` → `-`), drop `:` and the rest of `\ * ? " < > | # ^ [ ]`, collapse spaces. Names rarely carry these, but a slash in a hyphenated/transliterated name or a trailing `:` would silently break every `[[<Display Name>]]` link. Use the one sanitized string for the filename, `name:`, and every wikilink — identical.

Use `_schemas/person.md` as the contract. Fill every field you confidently inferred; leave the rest empty (per `AGENTS.md`: "leave optional fields empty rather than inventing metadata").

**Defaults that often need attention:**

- `status: active`
- `sensitivity: private` (do not lower without explicit user instruction)
- `relationship_strength:` — only set if you have a confident signal (e.g., 10+ threads = `medium`+; one cold intro = `low`). Otherwise leave empty.
- `contact_cadence:` — only set if the user told you; otherwise leave empty.
- `next_touch:` — leave empty unless the caller specified.
- `created:` / `updated:` — today's date.
- `id:` — `person-<slug>` where slug is lowercase-kebab-case of the display name.

**Body sections — what to actually fill:**

- `# At a glance` — 1–2 sentences. Name, role, why-they-matter.
- `# Current relationship context` — one paragraph synthesizing what the Gmail threads tell you about where the relationship is right now. Honest, not aspirational.
- `# Active threads` — bullet list of topics currently in flight, from the most recent threads.
- `# What they can help with` — capability tags + relevant Concept links.
- `# What I can help them with` — leave a placeholder if unclear.
- `# Open loops` — bullets under `## Waiting on them` and `## I owe them` based on email threads where commitments are visible.
- `# Project connections` — wikilinks if you found matches in Step 2; otherwise empty.
- `# Conversation history` — the threads you pulled in Step 1, newest first, dated, with a one-line summary each.
- `# Preferences` — if the threads reveal communication style (terse, detailed, formal, etc.), note it. Otherwise leave empty.
- `# Important personal context` — leave empty unless the threads contain explicit, sensitive-but-not-private facts the relationship depends on. Per the schema: "Do not invent personal facts. Every fact under 'Important personal context' must trace to an interaction note." If you write something here, drop an `[[…]]` link.
- `# Boundaries / sensitivities` — leave empty unless explicitly known.
- `# Last reviewed` — today's date.

## Step 4 — Log the mutation

Append one line to `log.md` at the top (newest first):

```
<datetime> — agent:librarian — create — [[<Display Name>]] — backfilled from Gmail (<N> threads, last contact <date>) | <one-line context>
```

If you found zero threads, say `seeded fresh; no prior Gmail correspondence`.

## Step 5 — Open in browser via Quartz (default)

The artifact is the new Person note at `Atlas/People/<name>.md`. The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/People/<name>"
```

When this skill is invoked as a sub-agent of `ingest-project`, suppress the open call (the parent skill opens the Project page, not every spawned Person). Skip also if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 6 — Report back

```
Created [[<Display Name>]] at Atlas/People/<Display Name>.md
- Gmail backfill: <N> threads found, last contact <date>, email <addr>
- Org: <existing wikilink | suggested new: <Org>>
- Suggested follow-ups:
  - Add [[<Display Name>]] to [[<Y>]] people.collaborators? (existing project, did not auto-edit)
  - Consider creating [[<Org>]] (no existing note)
```

## When to call this skill vs. inline

- **Always call this skill** when a new Person enters the vault — even one-off, even from a triage flow.
- **Don't recurse** if you're already inside this skill — you're already doing the Gmail move.
- **Parent skills** (`ingest-project`, `triage-inbox`) should dispatch this skill in parallel for each new Person, one sub-agent per Person, with `model: "sonnet"` (Gmail interpretation needs judgment — Haiku is risky here).

## Model recommendation when this skill is the sub-agent

If a parent skill is dispatching you as a sub-agent, run on **Sonnet**. The Gmail extraction has enough judgment in it (which signature is theirs vs. a colleague's; which threads are "recent and relevant" vs. one-off) that Haiku occasionally gets it wrong. Reserve Haiku for the inner "read these specific threads and pull fields" step where the prompt is mechanical.
