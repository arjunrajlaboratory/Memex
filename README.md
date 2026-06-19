# Memex

> "A memex is a device in which an individual stores all his books, records, and communications, and
> which is mechanized so that it may be consulted with exceeding speed and flexibility. It is an
> enlarged intimate supplement to his memory."
>
> — Vannevar Bush, *As We May Think* (1945)

**Memex is a second brain that helps you track your work** — a personal knowledge base that an AI
agent (Claude Code) actively maintains for you. You talk to it in plain language, or drop files into
it, and it files, links, researches, drafts, and keeps track of everything so you don't have to hold
it all in your head.

You don't learn an app. You just say what you want:

- **"Here are some ideas — file them."** Brain-dump into the inbox (or drop in a folder of notes,
  screenshots, and PDFs); Memex sorts each item into the right place — an idea, a task, a source, a
  person — and tells you what it did.
- **"Turn this idea into a project — research it, then help me execute it."** It researches the
  outside landscape *and* your own vault, writes up what it found plus a proposed first step, promotes
  the idea into a real project, and breaks it into tasks you can actually start.
- **"Here's a stack of PDFs — turn them into a research topic."** It ingests each one as a source,
  pulls out the threads, and assembles a linked topic page that ties them together.
- **"Update this letter of recommendation using the new CV in my email."** It finds the CV in your
  inbox, reads what changed, and redrafts the letter from your prior letters and your history with
  the person. *(academic-PI pack)*
- **"Where did we leave off?"** / **"Give me today's briefing."** A daily dashboard of what's due,
  what's blocked, what came in over email and Slack, and the best next move.

Under the hood it's just a folder of plain Markdown notes — typed and cross-linked (projects, tasks,
people, sources, decisions, ideas) that you fully own: no proprietary format, no lock-in. The guiding
principle is **capture first, structure on demand** — drop things in whenever they show up and let the
agent file them later. The same vault also publishes as a browsable, searchable website with live
dashboards.

## The engine and your vault

This repository is the **engine** — the skills, note types, and tooling that make Memex work. It
doesn't hold any notes. When you set it up, the engine stands up **your own vault**: a separate folder
(its own git repo) where your second brain actually lives — your projects, tasks, people, ideas, and
notes. The engine stays generic; your vault holds your data. As the engine improves, you pull those
improvements into your vault without disturbing anything that's yours.

You pick what the engine installs at setup:

- **core** (always): everything the second brain needs to run — the skills that capture, file,
  research, and track your work, plus the note types they use.
- **pi** (optional): an example tailored to an academic PI — drafting recommendation letters,
  keeping a CV current, and tracking grants.

## Quickstart

```bash
# 1. Get the engine
git clone https://github.com/arjunrajlaboratory/Memex.git
cd Memex

# 2. Stand up your own vault (interactive: asks your name, emails, paths, ports)
bin/memex-init --target ~/code/my-vault --packs core --interview
#    ...or --packs core,pi for the academic-PI example (letters / CV / grants)
#    ...or --answers answers.json to run non-interactive

# 3. Serve the local dashboard site
cd ~/code/my-vault/quartz && npm install && npm run site:serve   # http://localhost:<your port>

# 4. Open the vault with Claude Code (or your agent of choice) and start driving it
cd ~/code/my-vault && claude
```

The interview bakes your answers directly into the installed vault and records exactly which engine
files were installed in `.memex/manifest.json`. Framework files are engine-owned and updatable;
put durable local preferences in `_config/overrides.md` (or `_config/sources.md` for stream settings).
If you edit a framework file in place, Memex treats that as a local fork and the update flow will
surface it for merge/choice instead of silently overwriting it. Each vault uses a distinct Quartz port
so several can run at once. To serve durably (auto-start at login, survive sleep), install the LaunchAgent in
`<vault>/scripts/launchd/` (copy the plist to `~/Library/LaunchAgents/` and `launchctl bootstrap`).

## Updating an installed vault

Fresh installs track the engine version, answers, file ownership, and framework baselines under
`.memex/`. To adopt a newer engine checkout:

```bash
cd <vault>
<engine>/bin/memex-update --vault . --non-interactive
```

With git enabled, the updater refuses a dirty worktree, creates an `engine-update-<version>` branch,
applies deterministic-safe changes, and writes a plan under `.memex/update-work/` for any local
framework edits, collisions, config/code choices, or rename candidates. Run `/update` inside the vault
for the agent-guided merge layer; it resolves the plan and finalizes `.memex/manifest.json` plus the
baseline. With git mode `none`, review the written plan/report instead of a branch diff.

## First prompts to try

Once the vault is open in your agent, these get you moving. Each works as plain language *or* as a
slash command:

- **`/session-start`** — or *"where did we leave off?"* — a 5-second pre-flight: log tail, open tasks, inbox state, and a recommended next move.
- **`/daily-briefing`** — *"give me today's briefing"* — the flagship daily dashboard (top outcomes, calendar, tasks due, what's blocked, what needs triage), opened in the browser.
- **`/ingest-source <url-or-path>`** — *"pull this paper into the vault: <url>"* — lands an article / PDF / URL as a typed Source note and updates the wiki pages it touches.
- **`/create-task`** — *"add a task to email Alex by Friday"* — a schema-conformant Task with the right parent project, an id, and a calendar block when there's a time.
- **`/triage-inbox`** — *"triage the inbox"* — walks every unfiled capture in `Inbox/` and routes each to the right typed note until the drop zone is empty.
- **`/weekly-review`** — *"let's do the weekly review"* — zoom out: stale projects, slipping commitments, what to drop.
- *(pi pack)* **`/draft-letter`** — *"draft a tenure letter for [[Alex Kim]]"* — drafts from prior letters + relationship context, to the Letter schema.

The core loop: drop files into `Inbox/` whenever they show up, then run `/triage-inbox` later to file
them — capture first, structure on demand.

## Maintain the engine (maintainer)

The engine template is *derived* from a source vault and must carry zero instance facts. After
changing `packs.json` / `placeholders.json` / `scrub.json`, re-derive and re-check:

```bash
python3 tools/derive.py --src ~/code/your-source-vault --eng .     # rebuild packs/ + hardened/ (never writes to --src)
python3 tools/audit_literals.py ./packs                   # must be AUDIT CLEAN
python3 tools/audit_literals.py ./hardened                # must be AUDIT CLEAN
python3 tools/audit_refs.py .                          # must be REFS CLEAN
(cd tools && python3 -m unittest)                         # bake() unit tests
tests/test_init.sh                                        # full init integration test (core + pi)
tests/test_hooks.sh                                       # hook behavior + bash 3.2 parse guard (#13)
```

Run `tests/test_hooks.sh` on macOS (system bash 3.2): it exercises `log-mutation.sh` under
`/bin/bash` and statically forbids the heredoc-in-`$()` form that bash 3.2 can't parse. Since the
hooks are derived from the source vault, re-deriving from a source whose hook still has that pattern
would reintroduce the bug — this gate catches that.

`derive.py` never modifies the source vault, and its selective wipe never touches the hand-curated
`hardened/contract/` (AGENTS.base.md, CLAUDE.base.md, pi-fragment.md).

### Optional-token prose (conditional sections)

Some tokens are optional — `OWNER_FORWARDING_EMAIL` and `OWNER_SENDING_ACCOUNTS` may be blank.
For those, don't just drop the token: drop the *prose* around it, or a blank answer bakes broken
text (empty `` `` `` pairs, dangling clauses). `bake()` understands two Mustache-style sections,
resolved before plain token substitution:

- `{{?TOKEN}}…{{/TOKEN}}` — keep the span only when `TOKEN` is **non-blank**
- `{{^TOKEN}}…{{/TOKEN}}` — keep the span only when `TOKEN` is **blank**

```markdown
`{{OWNER_PRIMARY_EMAIL}}` is primary{{?OWNER_FORWARDING_EMAIL}}; `{{OWNER_FORWARDING_EMAIL}}` forwards in{{/OWNER_FORWARDING_EMAIL}}.
{{?OWNER_SENDING_ACCOUNTS}}Other sending accounts: `{{OWNER_SENDING_ACCOUNTS}}`.{{/OWNER_SENDING_ACCOUNTS}}
```

Sections whose token is absent from the answers pass through intact (same rule as unknown tokens, so
note-creation placeholders like `{{YYYYMMDD}}` are unaffected). Keep them flat — same-token nesting is
not supported. `tests/test_init.sh` has a general gate asserting a blank-forwarding init bakes no empty
inline-code pairs, so any future optional token gets caught.

**Derive-compatibility:** `packs/` is regenerated by `derive.py`, so these markers must originate in
the **source vault's own prose** — wrap them around the real literal (`…is primary; \`real@addr\` forwards
in`). They're inert in Obsidian/agents, and derive's literal→token swap turns the inner literal into
`{{TOKEN}}` while the markers survive verbatim. No `derive.py` change is needed; editing `packs/`
directly would be clobbered on the next re-derive.

## How it fits together

| File | Role |
|---|---|
| `packs.json` | which source files belong to `core` vs `pi` vs `hardened` |
| `VERSION` | semver label recorded into installed vault manifests |
| `engine_layout.json` | ownership classes for framework, seed, and data paths |
| `placeholders.json` | instance facts as `{{TOKENS}}` + the exact source literals they replace |
| `scrub.json` | derive-time genericization of third-party PII in skill *examples* |
| `audit_allowlist.json` | detector hits accepted as-is (vendored strings, institution names in examples) |
| `tools/derive.py` | maintainer: source → template, literals → tokens |
| `tools/memex_init.py` | user: template → new vault, tokens → your answers |
| `tools/memex_update.py` | user: newer engine → installed vault, preserving local framework edits |
| `tools/audit_literals.py` | the completeness gate (no instance fact leaks into the template) |
| `bin/memex-init` | the user-facing entrypoint |
| `bin/memex-update` | the user-facing update entrypoint |

**derive** (literals → tokens) and **init** (tokens → answers) are inverses across the same catalog.

## Not yet done

- **Notion pack**: see the design docs' deferred lists.
