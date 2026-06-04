# memex-engine

The distributable engine behind a [Memex vault](https://github.com/exampleorg/vault): a
discipline for an LLM-maintained knowledge base plus a librarian agent that grows structure on
demand. Ships as **packs** you opt into, derived from a real vault but carrying none of its data.

- **`core` pack** (always): the ~23 job-agnostic skills + the core typed-note schemas + templates +
  workflows + prompts.
- **`pi` pack** (optional): the academic-PI example — letters / CV / grants (`draft-letter`,
  `ingest-letters`, `cv-scan`, `cv-build` + the Letter/Grant schemas + CV LaTeX).
- **hardened core** (always): the two discipline hooks + their `settings.json` wiring, the Quartz
  static-site + dashboards emitter, the contract template, the vault `.gitignore`, the launchd
  durable-serve setup.

Instance-specific facts (your name, emails, paths, Drive IDs) live as `{{TOKENS}}` and are baked in
at setup. See the companion design docs in the source vault (the productization design blueprint and
`MEMEX_SPECIFICATION.md`).

## Stand up a new vault (user)

```bash
bin/memex-init --target ~/code/my-vault --packs core --interview
# (or --packs core,pi for the academic-PI example; or --answers answers.json for non-interactive)

cd ~/code/my-vault/quartz && npm install && npm run site:serve   # http://localhost:<your port>
```

The interview asks for your name, emails, framing, paths, Quartz port (use a distinct port per
vault so several can run at once), and — if you chose `pi` — the letters Drive IDs. Everything is
baked directly into your local, editable skill files. After init, the vault is yours: edit any
skill to suit your flow.

To durably serve the site (auto-start at login, survive sleep), install the LaunchAgent: see
`<vault>/scripts/launchd/` (copy the plist to `~/Library/LaunchAgents/` and `launchctl bootstrap`).

## Maintain the engine (maintainer)

The engine template is *derived* from a source vault and must carry zero instance facts. After
changing `packs.json` / `placeholders.json` / `scrub.json`, re-derive and re-check:

```bash
python3 tools/derive.py --src ~/code/your-source-vault --eng .     # rebuild packs/ + hardened/ (never writes to --src)
python3 tools/audit_literals.py ./packs                   # must be AUDIT CLEAN
python3 tools/audit_literals.py ./hardened                # must be AUDIT CLEAN
(cd tools && python3 -m unittest)                         # bake() unit tests
tests/test_init.sh                                        # full init integration test (core + pi)
```

`derive.py` never modifies the source vault, and its selective wipe never touches the hand-curated
`hardened/contract/` (AGENTS.base.md, CLAUDE.base.md, pi-fragment.md).

## How it fits together

| File | Role |
|---|---|
| `packs.json` | which source files belong to `core` vs `pi` vs `hardened` |
| `placeholders.json` | instance facts as `{{TOKENS}}` + the exact source literals they replace |
| `scrub.json` | derive-time genericization of third-party PII in skill *examples* |
| `audit_allowlist.json` | detector hits accepted as-is (vendored strings, institution names in examples) |
| `tools/derive.py` | maintainer: source → template, literals → tokens |
| `tools/memex_init.py` | user: template → new vault, tokens → your answers |
| `tools/audit_literals.py` | the completeness gate (no instance fact leaks into the template) |
| `bin/memex-init` | the user-facing entrypoint |

**derive** (literals → tokens) and **init** (tokens → answers) are inverses across the same catalog.

## Not yet done

- **Notion pack** and **upstream-update merge UX**: see the design doc's deferred list.
