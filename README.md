# memex-engine

The distributable engine behind a [Memex vault](https://github.com/exampleorg/vault): a
discipline for an LLM-maintained knowledge base plus a librarian agent that grows structure on
demand. Ships as **packs** you opt into, derived from a real vault but carrying none of its data.

- **`core` pack** (always): the 24 job-agnostic skills + the core typed-note schemas + templates +
  workflows + prompts.
- **`pi` pack** (optional): the academic-PI example — letters / CV / grants (`draft-letter`,
  `ingest-letters`, `cv-scan`, `cv-build` + the Letter/Grant schemas + CV LaTeX).
- **hardened core** (always): the three discipline hooks + their `settings.json` wiring, the Quartz
  static-site + dashboards emitter, the contract template, the vault `.gitignore`, the launchd
  durable-serve setup.

Instance-specific facts (your name, emails, paths, Drive IDs) live as `{{TOKENS}}` and are baked in
at setup. See the companion design docs in the source vault (the productization design blueprint and
`MEMEX_SPECIFICATION.md`).

## Quickstart

```bash
# 1. Get the engine
git clone https://github.com/exampleorg/memex-engine.git
cd memex-engine

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
