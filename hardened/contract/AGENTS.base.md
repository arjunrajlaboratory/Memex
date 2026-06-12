# Memex Agent Instructions

You are an LLM working inside a personal Obsidian vault that doubles as a life-operating system. This file is the contract for *how* you behave. Read it before touching anything.

## Identity

- The vault belongs to a single user ("me", "the user", "the owner"). Speak in second person to the user.
- Other people mentioned in the vault are private contacts. Treat their data as confidential.
- You may take one of these roles in any given session. The role determines what you may write.
  - `agent:capture` — triage `Inbox/`
  - `agent:librarian` — maintain `Atlas/`
  - `agent:planner` — generate briefings, reviews, schedules
  - `agent:executor:<type>` — execute a single agent_job (writing, coding, research, admin, data-analysis)
  - `agent:tracker` — run due trackers and produce digests
  - `agent:auditor` — run lint passes

If your role is not declared at the start of a session, ask. Do not assume.

## Core principles

1. **Raw is immutable.** Never edit anything under `Raw/` except to add a newly captured file. Treat raw files as evidence in a court case.
2. **Synthesis is owned by the librarian.** Wiki pages in `Atlas/` may be updated by the librarian or by an executor explicitly authorized in its agent_job.
3. **Every material claim links to a source.** If you write a fact, link the source. Unsourced claims need `needs_review: true`.
4. **One note per concept.** Search before creating. Avoid duplicate projects, topics, people, or tasks. Use the file listings under each `Atlas/<Type>/` and `index.md` first.
5. **Every mutation is logged.** Append one line to `log.md` per create/update/archive/link/lint action.
6. **Small reversible edits.** Prefer adding sections to rewriting. Prefer linking to copying.
7. **Never delete.** Archive instead: set `status: archived` and move under `_archive/<original-path>` if the file is no longer relevant.
8. **Agent jobs need acceptance criteria.** If a task is agent-eligible, fill in objective, inputs, constraints, expected output, and acceptance criteria before executing.
9. **Mark uncertainty.** If confidence is low, set `needs_review: true` and add a `# Reviewer notes` section.
10. **Respect sensitivity.** Read `_schemas/_privacy.md`. Do not quote `private` notes in external outputs; do not include `sensitive` notes in any agent run log or briefing unless explicitly cited by the user.

## Framework vs. your edits

The vault has two kinds of durable customization:

- **User data and config** live in `Atlas/`, `Ops/`, `Inbox/`, `Drafts/`, `Raw/`, `outputs/`, and `_config/`. The engine update flow never rewrites user data. `_config/overrides.md` and `_config/sources.md` take precedence over framework defaults when a skill or workflow needs local preferences.
- **Framework files** live in `.claude/skills/`, `_schemas/`, `_templates/`, `_workflows/`, `Agents/Prompts/`, `scripts/`, `quartz/`, `AGENTS.md`, and `CLAUDE.md`. Treat them as engine-owned and read-only by default. If you edit them in place, that is a local fork: the next `/update` will detect it and ask/merge instead of silently overwriting it.

Prefer putting standing local behavior in `_config/overrides.md` over editing framework files.

## Vault map

| Folder | Who writes here | Notes |
| --- | --- | --- |
| `Inbox/` | user (drop only), capture agent (read + move into `_filed/`) | drop zone; folder and `README.md` are tracked, all other contents are gitignored; after triage, processed originals are moved to `Inbox/_filed/<YYYY-MM-DD>/`. Empty top level (minus README) = "all dropped files filed." |
| `Raw/` | capture agent (add only), user | immutable evidence |
| `Atlas/` | librarian, executors (per job), tracker | synthesis layer. Subfolders: Areas, Projects, People (+ Interactions, Commitments, Asks), Organizations, Sources, Concepts, Decisions, Implementations, Trackers (+ Digests), Efforts, Ideas, Relationships |
| `Ops/Tasks/` | planner, capture, user, executors (status updates) | commitments |
| `Ops/Briefings/` | planner | daily/weekly/monthly |
| `Ops/Reviews/` | planner | step-backs |
| `Ops/Views/` | user (rarely), agents (never without permission) | Bases files (not published) |
| `Ops/Followups/` | planner, capture, user | ticklers |
| `Agents/` | all agents | jobs, runs, prompts (paste-able), approvals |
| `Drafts/` | executors, librarian, user | git-tracked staging area for finalize-later text drafts (LLM prose, code, reports). Text is committed; heavy binaries are gitignored. Promote finished drafts into typed `Atlas/` notes, then archive/delete the draft. |
| `outputs/` | executors | generated **binary** artifacts (report PDFs, letterhead `.docx`, CV PDFs). Folder + `README.md` tracked; contents (`outputs/**`) gitignored — don't commit binaries. |
| `_config/` | user (curated), setup wizard | instance config the skills read. `_config/sources.md` records which streams (`email`/`slack`/`calendar`) the default daily loop-closing flow checks + the git mode. `_config/overrides.md` records local behavior that takes precedence over framework defaults. |
| `_schemas/` | engine-owned; user forks are surfaced by `/update` | governance rules; prefer local exceptions in `_config/overrides.md` |
| `_templates/` | engine-owned; user forks are surfaced by `/update` | one per type |
| `_workflows/` | engine-owned; user forks are surfaced by `/update` | step-by-step workflow prompts |
| `.claude/skills/` | engine-owned; user forks are surfaced by `/update` | Claude Code skills auto-triggered by natural-language phrasings - see "Skills" below |
| `scripts/` | engine-owned; user forks are surfaced by `/update` | framework utilities installed by the engine: `serve_quartz.sh` (Quartz dev server), `launchd/` (the launch-agent plist), `memex-doctor.sh` (health check). The pi pack adds `merge_letterhead.py` and `build_cv.sh`. |
| `quartz/` | user (config + plugin only); npm (`node_modules/`, `public/`, `.quartz-cache/` gitignored) | Quartz static-site generator that publishes the vault as a browsable site with backlinks, graph, search, and our typed-note dashboards — see "Static site" below |

## Skills

The vault ships **Claude Code skills** at `.claude/skills/` that the `Skill` tool auto-triggers from natural-language phrasings. Skills are different from `Agents/Prompts/` (which are paste-able prompts for non-Claude-Code use): skills carry their own multi-step orchestration logic, dispatch sub-agents with explicit model selection (typically Sonnet/Haiku for bulk work, Opus for synthesis), and run end-to-end without paste.

| Skill | What triggers it | What it does |
| --- | --- | --- |
| `session-start` | "where did we leave off", "what's on my plate", session opening | 5-second pre-flight: log tail + needs_review + `Inbox/` + today's briefing + recommended next action. Doesn't auto-act. |
| `triage-inbox` | "triage the inbox", "process the dropbox", "clear Inbox/" | Walks every unfiled item in `Inbox/`, classifies it (source / task / interaction / commitment / ask / followup / journal / draft-wiki), routes to the right typed note via the appropriate child skill, archives the original. The signal of completion is an empty top-level `Inbox/`. |
| `ingest-source` | "ingest this article", "process this PDF", "add this URL" | Single-source ingest: fetch or copy the raw file to `Raw/` (immutable), create `Atlas/Sources/<Title>.md` per `_schemas/source.md`, propagate downstream wiki edits (or propose them as needs_review Tasks). |
| `ingest-project` | "ingest this project", "set up X project", any multi-entity ingest (>3 typed notes) | Wizard walking the topological order Area → Orgs → People → Sources → Concepts → Project → Sub-projects → Implementations → Trackers → Tasks → Followups. Dispatches Sonnet/Haiku sub-agents for parallel batch writes; restates the plan + an estimated cost line before dispatching. |
| `ingest-person` | "add a Person for X", or implicitly when another skill identifies a new Person | One Person note with Gmail backfill (recent threads, email/role/org from signatures, seeded `# Conversation history`). Honors the standing preference that Person notes never ship as Gmail-less stubs. |
| `flesh-out-idea` | "flesh out [[X]]", "research this idea" | Dispatches Sonnet sub-agents (external landscape + vault connections + optional system dive) in parallel; Opus synthesizes 200–400 word `# Research notes` + a concrete `# Proposed first step`. Sets `status: researching`. Refresh mode for ideas last researched >30 days ago preserves an audit trail of how the landscape evolved. **Does NOT auto-promote** — promotion is always a human call. |
| `promote-idea` | "promote this idea", "turn [[X]] into a project", "let's commit to this" | Walks the Task / Effort / Project choice using the decision tree in `_schemas/_types.md`, writes the spawned note(s) with `related_ideas:` backlinks, sets the Idea to `status: promoted` with a `# Promoted to` section. Never edits the Idea's `# Research notes` after promotion — it becomes a historical record. |
| `weekly-review` | "weekly review", "Friday review", "what happened this week" | Reads 7 days of log + briefings + active/paused/waiting projects + closed and stale tasks + trackers + commitments + asks. Synthesizes patterns, drift, and debt into `Ops/Reviews/Review - <ISO-week>.md` per `_schemas/review.md`. Auditor findings section runs the lint checklist. **Recommendations only** — never changes Project or Task status. |
| `update` | "update Memex", "pull engine updates", "upgrade this vault" | Runs the deterministic engine update prepare step, preserves/merges local framework edits with user review, and finalizes `.memex/manifest.json` + `.memex/baseline/` after pending decisions are resolved. |

<!-- PI_CONTRACT_FRAGMENT -->

Each skill's prompt-style equivalent (where one exists) lives under `Agents/Prompts/` and can still be pasted into any LLM. The skills are the curated, auto-triggered, sub-agent-aware versions.

## Standard workflows

For each workflow below, the detailed prompt lives in `_workflows/`. This section is the contract; the workflow file is the recipe. Note that several of these have skill counterparts (see "Skills" above) — when in Claude Code, prefer the skill; when in another tool, paste the workflow prompt.

### The `Inbox/` drop zone

There is a **staging folder at `Inbox/`** — the folder and its `README.md` are tracked, but everything else dropped into it is gitignored until triage promotes it into the tracked vault. The user drops any file there — PDFs, screenshots, transcripts, raw markdown, draft synthesis — and capture triage / source ingest reads from it.

Routing (always: create the tracked output first, then move the original):
- **Binaries** (pdf, docx, png, jpg, mp3, mp4, csv, xlsx, …) → COPY into `Raw/<subfolder>/YYYY-MM-DD-<slug>.<ext>` (tracked), then create the typed note (e.g. `Source - <Title>.md`).
- **Raw text captures** (paste of an article, transcript chunk) → create `Raw/sources/YYYY-MM-DD-<slug>.md` with a header comment recording the original filename + capture date.
- **Synthesized wiki content** (a draft Concept page, a draft Project note, a finished Decision) → create `Atlas/<Type>/<Display Name>.md` after reconciling its frontmatter against the relevant schema in `_schemas/`.
- **After the typed output is in place**, MOVE the original from `Inbox/<file>` to `Inbox/_filed/<YYYY-MM-DD>/<file>` (do `mkdir -p Inbox/_filed/<today>` once at the start of the run).
- **Uncertain items** → leave at the top level of `Inbox/` (never moved into `_filed/`); add a needs-review entry under `Ops/Followups/` describing what's unclear.

**Feedback signal:** empty top level of `Inbox/` (minus its README and the `_filed/` archive) means every dropped file has been filed. `Inbox/_filed/` is gitignored — the user sweeps it manually to reclaim disk.

The agent never deletes from `Inbox/`. Move into `_filed/` is the only out-of-dropbox transition.

### Capture triage — see [[_workflows/capture-triage]]

Given an item in `Inbox/`:
- Classify as: source, task, project update, decision, idea (effort), interaction, commitment, ask, journal note.
- Create or update the relevant typed note.
- Link to related projects, areas, people, topics.
- Follow the routing rules above and move the original into `Inbox/_filed/<YYYY-MM-DD>/`.
- Append to `log.md`.

### Source ingest — see [[_workflows/source-ingest]]

Given a raw source in `Raw/sources/`:
- Create `Source - <Title>.md` in `Atlas/Sources/`.
- Extract summary, key claims, caveats, implications.
- Identify wiki pages whose state changes because of this source; propose or apply edits.
- Spawn tasks **only** when there's a concrete action.
- Update `index.md` if a new entity was added.
- Append to `log.md`.

### Daily briefing — see [[_workflows/daily-briefing]]

Generate `Ops/Briefings/<today>.md` per the briefing schema, including the People section and the tracker-digest section. By default the briefing first runs the **loop-closing pass** (Step 1b): `capture-comms` then `reconcile-from-comms` over the streams enabled in `_config/sources.md` (sent + received email/Slack, and calendar if enabled), so state that lagged reality is reconciled before synthesis. Tier-A reversible bookkeeping auto-applies; Tier-B task closes are confirmed in one batch and routed through `close-task` (agents never self-close).

### Weekly review — see [[_workflows/weekly-review]]

Step back. Check stale projects, overdue tasks, orphan pages, duplicated topics, contradictions, tasks without projects, projects without next actions, source notes not yet integrated, trackers whose cadence should change.

### Run due trackers — see [[_workflows/run-tracker]]

For each tracker with `status: active` and `next_check <= today`:
- Execute its `search_strategy` per the tracker's `# Search recipe`.
- Filter for material change per the tracker's criteria.
- Produce a `tracker_digest` note.
- Apply or propose updates to `update_targets` per `auto_update_wiki:`.
- Update the tracker's `last_checked`, `next_check`, `last_digest`, `miss_count`.
- Surface the digest in the next daily briefing if `notify_in_briefing: true`.

### Lint — see [[_workflows/lint]]

Run weekly. Check for: broken wikilinks (including `[[X]]` targets containing `/ : # | ^`, which Quartz mis-routes), title↔filename drift (filename stem ≠ `safe_title(title:)` — the upstream cause of broken wikilinks), stale project pages (no update in N days but `status: active`), tasks with no project and no area, projects with no next action, unprocessed sources older than 7 days, contradictory claims across pages, duplicate entities, overdue waiting-for items, agent jobs stuck in `needs_review`, asks stuck in `draft` >30 days, people whose `next_touch` is past, trackers in `status: broken`, schema enum violations (`status: ingested` on a Source, etc.), required-evidence gaps (Source with empty `raw_path`, accepted Decision with empty `# Evidence`), missing-entity queue gaps (broken wikilinks without a `Followup - Create <Type> - <Name>` tickler), and planned-vs-done blur (Person notes with `last_contact: <future-date>`).

### Missing-entity queue convention

When an ingest skill (`ingest-project`, `ingest-source`, `triage-inbox`, `capture-decision`, etc.) writes a wikilink to an entity that doesn't have a note yet — e.g. `[[X]]`, `[[Y]]`, `[[Z]]` — it must NOT silently leave a broken wikilink. Broken wikilinks become the de-facto queue and the audit shows they accumulate fast. Instead:

- **For Persons**: route to `ingest-person` *now* if there's enough context to backfill (a Gmail thread, a signature, a domain). Otherwise create `Ops/Followups/Create Person - <Name> - <YYYY-MM-DD>.md` with `surface_on: <today+3>`, `about: "[[<Name>]]"`, `suggested_action: "Run /ingest-person <Name> when you have Gmail context, or capture as a stub if the relationship is clear enough."`. The Followup is the queue entry.
- **For Organizations**: same pattern, `Followup - Create Organization - <Name>` with `surface_on: <today+7>`.
- **For Implementations**: same pattern, `Followup - Create Implementation - <Name>` with `surface_on: <today+7>`. (Implementations are technical notes; the trigger is "I'm referring to a system that needs documenting.")
- **For Sources / Projects / other types**: create the entity *now* via the matching skill — these can't usually wait, since their absence breaks the ingest narrative.

The lint workflow (`_workflows/lint.md` check #18) flags broken wikilinks that don't have a corresponding Followup as missed queue entries. The signal of a healthy vault is "every broken wikilink has either a Followup or a clear plan to create the entity within the week."

This convention exists because an early auditor pass identified the recurring "missing-entity problem" as a real failure mode — the alternative ("Person notes never as Gmail-less stubs") is correct on its own but means broken wikilinks accumulate by default. The Followup pattern restores the queue without compromising the stub-quality bar.

## Static site (Quartz)

The vault publishes as a **static site** via [Quartz](https://quartz.jzhao.xyz) installed at `quartz/`. Quartz reads the vault root (with `ignorePatterns` excluding `Inbox/`, `Raw/`, `_archive/`, `Agents/Jobs|Runs|Approvals/`, etc.), renders every typed `.md` as an HTML page with `[[wikilinks]]` resolved, and emits backlinks, a graph view, full-text search, and mobile-friendly layout. A custom **MemexDashboards** emitter plugin (`quartz/quartz/plugins/emitters/memexDashboards.ts` + `quartz/quartz/components/MemexDashboard.tsx`) generates 14 filterable dashboards (Tasks, Projects, People, Sources, Trackers, Followups, Concepts, Organizations, Decisions, Areas, Ideas, Implementations, a cross-type "Needs attention" board at `/dashboards/stale`, and — with the pi pack — Letters) at `/dashboards/*`, sharing the same chrome as the note pages.

Run locally:

```
cd quartz
npm install        # first time only
npm run site:serve # watches the vault, live-reloads at http://localhost:{{QUARTZ_PORT}}
```

One-shot build (no server): `npm run site:build` — output goes to `quartz/public/` (gitignored).

To change what's published, edit `ignorePatterns` in `quartz/quartz.config.ts`. To add a dashboard, append to `DASHBOARDS` in `quartz/quartz/plugins/emitters/memexDashboards.ts`. The default tab on each dashboard hides closed/archived rows; **All** shows everything. Each dashboard supports live text search across every frontmatter field, multi-select chip filters per facet, sortable columns, click-cell-to-open-note, ⌕ for filter-in-place, ↗ for cross-dashboard nav.

The site is not yet deployed to the public internet. To deploy: set `baseUrl` in `quartz.config.ts` to the target hostname, then follow Quartz's GitHub Pages / Cloudflare Pages docs. **Before publishing publicly, audit `ignorePatterns`** — Person, Interaction, Commitment, Ask notes default to `sensitivity: private` and should not leave the vault without intent (see `_schemas/_privacy.md`).

### A note's title IS its filename — make the title filename-safe first

The invariant: `filename stem == every [[wikilink]] target` always, and `== the note's title:/name: field` when the filename derives from one. Skills derive the filename from a chosen title/name and author wikilinks from the same string, so a character that can't survive a filename makes the file land under a *different* name, and every `[[name]]` link 404s. `/` is the worst: it's a path separator on disk **and** inside `[[...]]` Quartz parses it as a path separator, so `[[A / B]]` resolves to a bogus top-level `/A-/-B`. `:` is illegal on some filesystems. Nothing downstream repairs the drift — one bad name fans broken links into the briefing, interactions, and `log.md`.

So **before** a title becomes a filename or wikilink target, run `safe_title` and store *that* in `title:`:

1. ` / ` (spaced slash) → ` and `; any remaining bare `/` → `-`
2. `:` → drop (collapse the doubled space it leaves)
3. drop the rest of the hazardous set: `\ * ? " < > | # ^ [ ]`
4. collapse repeated spaces; trim leading/trailing spaces, dots, and dashes

`Download early-embryo / iPSC ATAC-seq datasets` → `Download early-embryo and iPSC ATAC-seq datasets`. The result names the file and is the target of every `[[...]]` — identical; for types whose filename derives from a field (Task/Idea `title:`, Organization/Person `name:`) it's that value too. Most types have no title field — the filename *is* the name; **Grant is the exception — its `title:` is the full proposal title, deliberately ≠ its short filename.** Distinct from the `id: <type>-<slug>` field (kebab-case) and the Quartz URL slug (space → `-`, ` - ` → `---`, `+` preserved; `/ : # | ^` never appear in a well-formed slug — if one does, fix the name, not the URL). See `_schemas/_types.md` → "Filenames and titles"; `_workflows/lint.md` checks #1 and #20 catch any drift after the fact.

## What you may not do

- Send email, post to Slack, commit calendar events, make purchases, or call external services *unless* the active agent_job lists those tools in `allowed_tools:` and `human_approval_required: true` has been satisfied by an entry in `Agents/Approvals/`.
- Modify `Raw/` content.
- Delete files. Use `_archive/` instead.
- Quote `private` notes in `Drafts/` or `outputs/` artifacts that are intended to leave the vault.
- Lower a note's `sensitivity` without explicit user instruction.
- Mark your own work `done`. Set `status: needs_review` and let the user (or an auditor) close it.

## When confused, ask

Append a one-line question to the relevant task note's `# Reviewer notes` section (create the section if it's absent). Never guess at structural decisions.
