# CLAUDE.md — Claude Code instructions for this vault

This repository is a personal Memex vault (see [README.md](README.md)). When Claude Code operates on this vault, the canonical contract is **[AGENTS.md](AGENTS.md)** — read it first. This file adds Claude-Code-specific notes that complement AGENTS.md without duplicating it.

## Where to start in a new session

1. Read `AGENTS.md`. Decide which role you're playing (`agent:capture`, `agent:librarian`, `agent:planner`, `agent:executor:<type>`, `agent:tracker`, `agent:auditor`) and what you may write. If unclear, ask.
2. Read the most recent entries in `log.md` to see what happened since the last session.
3. If today's briefing exists (`Ops/Briefings/<today>.md`), skim it.
4. The build plan and "what's done so far" live in `IMPLEMENTATION_PLAN.md` — the Changelog and Resume-here sections are the source of truth for state.

## Dropping files for ingestion

There is a **drop zone at `Inbox/`** — the folder and its `README.md` are tracked, but everything else dropped into it is gitignored until triage promotes it into the tracked vault. The user drops anything in there — PDFs, screenshots, transcripts, raw markdown, draft synthesis — and the triage workflow reads from it.

Routing rules the triage / ingest-source workflows follow for `Inbox/` items (create the tracked output first, then move the original):
- **Binaries** → COPY into `Raw/<subfolder>/` (tracked) with a `YYYY-MM-DD-<slug>.<ext>` filename, then create the typed note (e.g. Source).
- **Raw text captures** → create `Raw/sources/YYYY-MM-DD-<slug>.md` with a header comment recording the original filename + capture date.
- **Synthesized wiki content** (draft Concept, draft Project, finished decision) → create `Atlas/<Type>/<Display Name>.md` after reconciling frontmatter against `_schemas/`.
- **After the typed output is in place**, MOVE the original from `Inbox/<file>` to `Inbox/_filed/<YYYY-MM-DD>/<file>`. The agent does `mkdir -p Inbox/_filed/<today>` once at the start of the run.
- **Uncertain items** → leave in place at the top level of `Inbox/` (never moved into `_filed/`); surface as a needs-review entry in `Ops/Followups/`.

**Feedback signal:** empty top level of `Inbox/` (minus the README and the `_filed/` archive) means every dropped file has been filed. The `_filed/<date>/` archive is the local audit trail — gitignored, sweep it manually whenever you want to reclaim disk.

## Generated artifacts (`outputs/`)

There is a **gitignored `outputs/` folder** at the repo root for generated binary artifacts — intermediate templates, report PDFs, and other generated outputs. The folder itself and `outputs/README.md` are tracked; everything inside (matched by `outputs/**`) is gitignored per `.gitignore`.

The pattern: **typed vault notes hold metadata + reasoning; binary artifacts live in `outputs/` locally.** Don't paste artifact bodies into typed notes — and don't commit binaries to git.

<!-- PI_CONTRACT_FRAGMENT -->

## How prompts work here

Paste-ready prompts live under `Agents/Prompts/`:

| File | Purpose | Invoke when |
| --- | --- | --- |
| `triage-inbox.md` | Process every item in `Inbox/` | Morning, after captures accumulate |
| `ingest-source.md` | Bring one source into the wiki | New article/paper/transcript |
| `daily-briefing.md` | Generate today's briefing | Start of day |
| `weekly-review.md` | Friday step-back | End of week |
| `run-trackers.md` | Refresh due trackers | Monday morning or on demand |
| `lint.md` | Auditor pass | Weekly, before review |
| `shutdown-review.md` | End-of-day reflection | Before context-switching out |
| `new-tracker.md` | Wizard for adding a tracker | When you spot a topic worth watching |
| `_task-starter.md` | Help start work on a specific task | Beginning a focused 25-min block |
| `_agent-handoff.md` | Delegate one agent_job for unattended exec | All inputs satisfied; want unattended run |

These are not slash commands. Open the file, paste the `## Prompt` block into a fresh session (or run it inline), substitute parameters, and follow it.

In addition to the paste-able prompts above, the vault ships **Claude Code skills** under `.claude/skills/` that auto-trigger from natural-language phrasings (the `Skill` tool picks them up from their descriptions):

| Skill | Triggers on | What it does |
| --- | --- | --- |
| `session-start` | "where did we leave off", "what should I work on", "give me a status" | 5-second pre-flight: log tail + needs_review queue + `Inbox/` + today's briefing + recommended next action |
| `triage-inbox` | "triage the inbox", "process the inbox", "clear Inbox/" | One-by-one classification of `Inbox/` items; routes to typed notes via the right child skill; archives the originals to `Inbox/_filed/<today>/`. |
| `ingest-source` | "ingest this article", "pull this URL into the vault", "process this PDF" | Single-source ingest: fetch/copy raw to `Raw/`, create Source note per `_schemas/source.md`, update downstream wiki pages (or propose them as needs_review tasks). |
| `ingest-project` | "ingest this project", "set up X project", "make a project for ..." | Wizard for multi-entity ingest (Area/Orgs/People/Sources/Concepts/Project/Sub-projects/Trackers/Tasks) with parallel Sonnet/Haiku sub-agents and a cost estimate before dispatch. |
| `ingest-person` | "add a person for X", "create a Person note", or any new Person identified by another skill | One Person note with Gmail backfill (honors the standing user preference). |
| `flesh-out-idea` | "flesh out [[X]]", "research this idea", "do some research on ..." | Dispatches Sonnet sub-agents for parallel research (external landscape + vault connections + system dive), then Opus synthesizes a 200–400 word `# Research notes` section + a `# Proposed first step`. Sets `status: researching`. Refresh mode for ideas last researched >30 days ago. Does NOT auto-promote. |
| `promote-idea` | "promote this idea", "turn [[X]] into a project", "let's commit to this" | Walks the Task / Effort / Project choice (per `_schemas/_types.md`), writes the spawned note(s) with `related_ideas:` backlinks, sets the Idea to `status: promoted` with a `# Promoted to` section. |
| `create-task` | "add a task to ...", "create a task for ...", "block 30 min tomorrow for ...", "put time on for ..." | Writes one schema-conformant Task with a sequential `task-YYYYMMDD-NNN` id, picks the parent Project/Area, optionally creates a matching Google Calendar event when the capture includes a time block, and appends the log line. Invoked by `triage-inbox` and `promote-idea`. |
| `close-task` | "close [[X]]", "mark this task done", "I finished the X task" | Takes a Task to `status: done` (or `needs_review` / `canceled`) with the required final `# Work log` entry, removes it from the parent Project's `# Current next actions`, surfaces any downstream Tasks the close unblocks, and logs. Agents never set their own work to `done` — that's the user's call. |
| `capture-decision` | "I've decided to ...", "we're going with X over Y", "record this decision", "decision: ..." | Writes `Decision - <Title>.md` per `_schemas/decision.md` (the six body sections), links it from the parent Project/Area's `# Key decisions`, and handles the supersede chain when a new decision overrides a prior one. Decisions are append-only — never silently rewritten. |
| `daily-briefing` | "generate the daily briefing", "today's briefing", "morning briefing" | Auto-triggering version of `Agents/Prompts/daily-briefing.md`. Synthesizes the full 13-section briefing into `Ops/Briefings/<date>.md` and refuses to silently overwrite an existing briefing (especially one that already has `## Shutdown notes` appended). |
| `shutdown-review` | "shutdown review", "wrap up the day", "end-of-day notes" | Auto-triggering version of `Agents/Prompts/shutdown-review.md`. Walks the five reflection questions, appends `## Shutdown notes — <today>` to today's briefing, and cascades to every touched Task's `# Work log`. Queues learnings as Decisions for capture tomorrow rather than doing them inline. |
| `run-trackers` | "run the trackers", "Monday tracker pass", "any new digests?" | Auto-triggering version of `Agents/Prompts/run-trackers.md`. Runs each active+due tracker per its `search_strategy`, writes the digest, applies or proposes `update_targets` (per `auto_update_wiki`), and updates tracker bookkeeping. Honors `forbidden_actions:` literally. |
| `lint` | "run the lint", "audit the vault", "auditor pass" | Auto-triggering version of `Agents/Prompts/lint.md`. Runs the 15-check auditor pass and writes the report into the open weekly review (or a standalone `Lint - <date>.md`). Flag-only — proposes follow-on tasks but creates none. |
| `log-mutation` | "log this change", "append a log line for ..." | Tiny helper for the canonical `log.md` append. Invoked by other skills and by the user. The reason every other skill has a "Step N — Log" — keeps the vault audit trail honest. |
| `weekly-review` | "weekly review", "Friday review", "what happened this week" | Synthesizes 7-day log + briefings + active projects + closed/open tasks + trackers + commitments + asks into `Ops/Reviews/Review - <ISO-week>.md`. Patterns/drift/debt, not a re-summary. Recommendations only — never changes state. |
| `email` | "search my email for ...", "what did X say", "find the thread about ...", "did Y reply?", "draft a reply to ..." | General Gmail competence — the reusable home for *how to use email well*: the query cheat-sheet, the search-broadly-first technique (memory `feedback_gmail_search_technique`), reading full threads, and routing substantive email into the vault (→ `ingest-source` / `ingest-person` / `create-task`) or drafting a reply via `create_draft`. **Never sends** — drafts only. |

## Static site (Quartz)

The vault publishes as a static site via **Quartz** living at `quartz/`. Quartz reads the vault root, renders every typed `.md` as an HTML page, resolves `[[wikilinks]]`, builds a graph, exposes search, and is mobile-friendly. A custom emitter plugin (under `quartz/quartz/plugins/emitters/`) generates the typed dashboards (Tasks/People/Projects/…) alongside the note pages so it's one cohesive site.

Run locally:
```
cd quartz
npm install              # first time only
npm run site:serve       # http://localhost:8080, watches for changes
```

Build once (no server):
```
cd quartz && npm run site:build   # output goes to quartz/public/
```

`quartz.config.ts` carries the vault-specific `ignorePatterns` (skipping `Inbox/`, `Raw/`, `_archive/`, `Agents/Jobs|Runs|Approvals`, etc.). To publish or hide a folder, edit that list.

The Quartz emitter is now the only dashboard generator. The older Python script (`scripts/build_dashboards.py`) and its `_dashboards/` HTML output were retired on 2026-05-18 once the plugin reached parity.

### URL slugs — don't link the raw filename

When opening a note in the browser (`open "http://localhost:8181/<path>"`), the path is **not** the raw filename — Quartz slugifies it, and using the raw name with spaces 404s. The transform (verified 2026-05-31):

- A single space → `-` — `Alex Kim` → `Alex-Kim`
- ` - ` (space-hyphen-space, the common `Type - Title` and date separators) → `---` (**three** dashes) — `Review - 2026-W22` → `Review---2026-W22`; `ExampleProject - Growth and Marketing` → `ExampleProject---Growth-and-Marketing`
- `+` is preserved (with its surrounding spaces still becoming dashes) — `ExampleProject + ExampleCo` → `ExampleProject-+-ExampleCo`
- The `.md` extension is dropped; no `.html` in the URL.

So `Ops/Reviews/Review - 2026-W22.md` opens at `http://localhost:8181/Ops/Reviews/Review---2026-W22`, **not** `…/Review - 2026-W22`. When unsure of a slug, either check `quartz/public/<path>.html` (the built filename IS the slug) or `curl -s -o /dev/null -w "%{http_code}"` the candidate URL before sending it.

## Hooks (auto-discipline)

Two hooks live in `.claude/hooks/` and are wired up in `.claude/settings.json` — both fire silently and best-effort, so a hook failure can never break a session.

| Hook | Event | What it does |
| --- | --- | --- |
| `session-start-context.sh` | `SessionStart` (matchers: `startup`, `resume`, `clear`) | Emits a one-time dashboard at session start: 5 most-recent `log.md` entries, open Task counts by status, today's briefing existence, `Inbox/` top-level state, list of `needs_review` Task titles. Removes the cold-scan most agents do at the top of a vault session. |
| `bump-updated.sh` | `PostToolUse` (matchers: `Edit`, `Write`) | After any `Edit`/`Write` to an `.md` file under `Atlas/`, `Ops/{Tasks,Followups,Briefings,Reviews}/`, walks the YAML frontmatter and sets `updated:` to today. Skips `_archive/`, `Inbox/`, `_schemas/`, `_templates/`, `_workflows/`, `Raw/`. Idempotent. |

You can still set `updated:` explicitly when writing or editing a typed note — the hook just enforces the rule when you forget. `created:` is never touched by the hook.

## Tool-use conventions

- Prefer `Read` / `Edit` / `Write` over `cat` / `sed` / `echo` for files. The `Edit` tool requires a prior `Read` of the same file in this session — `awk`/`grep` does not count.
- Use `Bash` for git, `find`, `grep`, `ls`, `wc`.
- For broad exploration when you don't know paths, dispatch the `Explore` subagent rather than running many `grep`s manually.
- For parallel work (writing N independent notes), dispatch parallel subagents in a single message; have them write files only, then commit from the main session to avoid `.git/index.lock` races.

### Prefer skill invocation over manual mechanics

The vault ships 18 skills at `.claude/skills/` (see table above). For any matching natural-language phrasing — "close this task", "ingest this article", "set up project X", "weekly review", etc. — invoke the skill via the `Skill` tool rather than reproducing its mechanics by hand. The skills enforce the schema rules, the `log.md` append discipline, the parent-page bookkeeping (`# Current next actions`, `# Changelog`, area links), and the cascading state changes (unblocks, surfacing followups) that are easy to forget under fatigue. Manual edits are still fine for one-off adjustments that don't have a skill, but anytime you find yourself opening 3+ files to do "the X workflow", check whether `Skill` already wraps it.

### In-app TodoWrite is not the vault tracker

Claude Code periodically reminds agents to use the built-in `TodoWrite` / "TaskCreate" tracker. **Ignore those reminders in this vault.** The canonical task tracker is the typed Task notes under `Ops/Tasks/` (created via the `create-task` skill, closed via `close-task`). `TodoWrite` is fine for very short-lived intra-session checklists (e.g. multi-step refactors inside a single turn) but is **not** where the user's commitments live.

## Schema cheat sheet

Quick-reference frontmatter for the three most-touched typed notes. The full schemas (including body section requirements and rules) live in `_schemas/`; read them when authoring is non-trivial. For other types — Source, Decision, Idea, Concept, Tracker, Followup, Interaction, Commitment, Ask, Effort, Journal, Implementation, Relationship, Organization, Briefing, Review — read `_schemas/<type>.md` directly.

### Task — `Ops/Tasks/<title slug>.md`

```yaml
type: task
id: task-YYYYMMDD-NNN              # sequential per-day; grep current tasks to find next NNN
title: "<concise imperative>"
status: next                       # inbox | backlog | next | scheduled | in_progress | waiting | needs_review | done | canceled
project: "[[<Name>]]"    # may be empty if area-level
area: "[[<Name>]]"
owner: me                          # me | "[[<Name>]]" | "[[Agent - <role>]]"
priority: p2                       # p0 | p1 | p2 | p3
importance: 4                      # 1–5
urgency: 3                         # 1–5
effort: 45m                        # 5m | 25m | 45m | 1h | 2h | 1d
due: YYYY-MM-DD
scheduled_start:                   # ISO datetime; REQUIRED when status=scheduled
scheduled_end:                     # ISO datetime; REQUIRED when status=scheduled
people: []                         # ["[[<Name>]]", ...]
delegate_type: me                  # me | human | agent
agent_eligible: false
acceptance_criteria: ["..."]
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD                # auto-bumped by .claude/hooks/bump-updated.sh
```
Body: `# Objective` / `# Context` / `# Inputs` / `# Steps` / `# Acceptance criteria` / `# Risks / constraints` / `# Starter prompt` / `# Work log` (+ `# Agent handoff` if `agent_eligible: true`).
Hard rules: `waiting` requires `waiting_on:`. `scheduled` requires `scheduled_start`+`scheduled_end`. `done` requires a final `# Work log` entry. No `project:` is OK only if `area:` is set.

### Project — `Atlas/Projects/<Display Name>.md`

```yaml
type: project
id: prj-<slug>
status: active                     # active | paused | waiting | archived | done | dropped
area: "[[<Name>]]"
phase: design                      # idea | design | building | shipping | maintaining
importance: 5
urgency: 4
energy: medium                     # low | medium | high
started: YYYY-MM-DD
target_date: YYYY-MM-DD
next_review: YYYY-MM-DD
people:
  stakeholders: []
  collaborators: []
  reviewers: []
  decision_makers: []
sources: []
open_task_query: "type = task and project = prj-<slug> and status != done"
agentifiable: true
sensitivity: normal
created/updated: YYYY-MM-DD
```
Body: `# Outcome` / `# Current status` / `# Why this matters` / `# Open loops` / `# Current next actions` / `# Key decisions` / `# Risks / blockers` / `# Source notes` / `# Implementation notes` / `# Changelog`.
Hard rules: status=waiting must say what it's waiting on. Closing or pausing a Task that's listed in `# Current next actions` requires removing it from that list and updating `# Changelog`.

### Person — `Atlas/People/<Display Name>.md`

```yaml
type: person
id: person-<slug>
name: "<full name>"
status: active                     # active | dormant | estranged | deceased | archived
relationship_category: [collaborator|friend|advisor|mentor|mentee|family|investor|customer|vendor|acquaintance]
organization: ["[[<Name>]]"]
role: ""
email: ""
preferred_contact_method: email
contact_cadence: monthly           # weekly | biweekly | monthly | quarterly | yearly | adhoc
last_contact: YYYY-MM-DD
next_touch: YYYY-MM-DD
relationship_strength: medium      # low | medium | high
sensitivity: private               # DEFAULT — never lower without explicit instruction
share_with_agents: limited
allowed_agents: [planner, personal-crm]
contains_personal_data: true
created/updated: YYYY-MM-DD
```
Body: `# At a glance` / `# Current relationship context` / `# Active threads` / `# What they can help with` / `# What I can help them with` / `# Open loops` (with `## Waiting on them`, `## I owe them`, `## Follow-up opportunities` subsections) / `# Project connections` / `# Conversation history` / `# Preferences` / `# Important personal context` / `# Boundaries / sensitivities` / `# Last reviewed`.
Hard rules: default `sensitivity: private`. Never invent personal facts — every `# Important personal context` entry must trace to an Interaction. **Always backfill from Gmail when creating** (standing user preference — see `feedback_enrich_people_from_gmail` memory).

## Git commit conventions

- One commit per logical change.
- Message format: `<scope>: <what>` — e.g. `briefing: 2026-05-18`, `tracker: example gist digest 2026-06-17`, `cleanup: archive example notes`, `phase-7: ...` during bootstrap.
- Every commit ends with the standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Never `--amend`, `push --force`, or skip hooks without explicit user instruction.

## When you write a note

- Conform to the schema in `_schemas/<type>.md`. Read the schema before authoring.
- `created:` is set once at first write; `updated:` is bumped on every subsequent write.
- Wikilinks inside YAML frontmatter are quoted strings: `project: "[[X]]"`.
- Person / Interaction / Commitment / Ask notes default to `sensitivity: private`.
- After any vault-content mutation, append one line to `log.md`:
  `<datetime> — <actor> — <verb> — <[[target]]> — <one-line summary>`.

## Model selection in steady state

- **Sonnet** is sufficient for: transcribing structured content, applying a known schema, summarizing one source, drafting a single email, querying one slice of the vault.
- **Opus** for: daily briefings (cross-vault synthesis), weekly reviews, lint passes, and any task that needs judgment across many entities at once.

The full per-phase guidance lived in `IMPLEMENTATION_PLAN.md`'s Model-selection table for the build; steady-state defaults follow the same logic.

## Known Bases version quirks (as of 2026-05-17)

The vault was built against Obsidian Bases 1.7+ but the installed version has these quirks. If you author or patch a view file (`*.base`), use the workarounds below; full notes in `IMPLEMENTATION_PLAN.md` Changelog.

- `note.status in [...]` not supported → use `or:` block of `==`.
- `note.status not in [...]` → use `and:` block of `!=`.
- `file.link` silently dropped from columns → use `file.name` (and/or `note.title` for typed notes that have a `title:` field).
- `columns:` apparently ignored when `order:` is present → put the full column list in `order:`.
- `type: board` not supported → use `type: cards` grouped by status.
- `type: calendar` not supported → use `type: table` sorted by the date field (install the Full Calendar community plugin for a real calendar).
- `date(today)`, `duration("Xd")`, and array-length checks (`note.X.length > 0`) not yet verified → currently date-narrowing filters are widened with `# TODO` comments. Don't remove a TODO until you've actually tested the narrower syntax.

## Hard nos (without explicit per-session opt-in)

- Send email, post to Slack, commit to external calendars, make purchases, call external services.
- Modify anything under `Raw/`.
- Delete files. Move to `_archive/<original-path>` and set `status: archived`.
- Lower a note's `sensitivity` without instruction.
- Mark your own work `status: done` — set `status: needs_review` and let the user close it.

**Authorized external writes (the explicit exceptions):**
- `create-task` may create a Google Calendar event on the user's primary calendar when the new Task carries a `scheduled_start`/`scheduled_end`. No other calendar writes.
- No other Drive writes — the vault never writes to Drive without explicit per-session opt-in.

## Out of scope (v0.1)

External integrations not yet wired: email send, Slack capture, mobile voice notes, TaskNotes HTTP API, scheduled tracker daemon. (Google Calendar event creation for Tasks landed via `create-task` — see Authorized external writes above. Wider Drive sync still deferred.) See "Out of scope" in `IMPLEMENTATION_PLAN.md`.
