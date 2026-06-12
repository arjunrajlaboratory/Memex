# Backport checklist — 2026-06-12 audit-fix branch

`packs/` and `hardened/{hooks,launchd,quartz,settings.json,gitignore}` are
**derive-managed**: `tools/derive.py` regenerates them from the source vault,
so any fix made directly in the engine repo is clobbered on the next re-derive
unless it is first mirrored into the source vault. This branch changed the
following derive-managed files — port each into the source vault **before**
running `derive.py` again. (`hardened/contract/` and `hardened/scripts/` are
hand-curated and survive re-derives; nothing to do for those.)

## Mirror into the source vault

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `hardened/hooks/log-mutation.sh` | `.claude/hooks/log-mutation.sh` | Full rewrite: single python3 process, flock on `.memex/log.lock`, atomic `os.replace` write, portable `fromisoformat` dedupe (replaces BSD-only `date -j`), vault scoping, `"file_path"` bash prefilter. |
| `hardened/hooks/bump-updated.sh` | `.claude/hooks/bump-updated.sh` | Full rewrite: drop `set -euo pipefail` (jq-less fallback killed the hook), `$REPO_ROOT`-anchored scoping (no longer bumps other repos), `cat`-over instead of `mv` (preserves inode/mode). |
| `hardened/hooks/session-start-context.sh` | `.claude/hooks/session-start-context.sh` | "Memex" branding (was "LifeOS"), single awk pass for task counts + needs_review (was 6 greps), quartz log to `outputs/quartz-serve.log` (was world-writable `/tmp`). |
| `hardened/settings.json` | `.claude/settings.json` | `permissions.deny` block (`.env*`, `secrets/**`, force-push) + anchored PostToolUse matcher `^(Edit\|Write)$`. |
| `hardened/launchd/com.you.memex-quartz.plist` | `scripts/launchd/…` | Label `com.memex.quartz.{{VAULT_NAME}}` (source vault: its real vault name), `ThrottleInterval 10`, logs to `{{VAULT_PATH}}/outputs/quartz-serve.log`. |
| `hardened/launchd/serve_quartz.sh` | `scripts/serve_quartz.sh` | Mode 755 (exec bit only; content unchanged). |
| `hardened/quartz/quartz/cli/handlers.js` | `quartz/quartz/cli/handlers.js` | `server.listen(argv.port, "127.0.0.1")` + `WebSocketServer({ host: "127.0.0.1", … })` — serve mode includes private notes; must not bind the LAN. |
| `hardened/quartz/quartz.config.ts` | `quartz/quartz.config.ts` | `ignorePatterns` += `.memex`, `_config`, `_config/**`; `baseUrl: "localhost:<your port>"` (derive tokenizes the port literal). |
| `hardened/quartz/package.json` | `quartz/package.json` | `site:build:public` no longer sets the phantom `QUARTZ_PUBLIC_BUILD` env var (read nowhere). |
| `hardened/gitignore` | `.gitignore` | += `.claude/settings.local.json` and `.memex/` (manifest embeds the interview answers). |
| `packs/core/schemas/_types.md` | `_schemas/_types.md` | `letter`/`grant` rows annotated "*(pi pack — core-only vaults omit this type)*". |
| `packs/pi/scripts/build_cv.sh` | `scripts/build_cv.sh` | **NEW file** — `/cv-build` always referenced it but the engine never shipped it. `derive.py` now handles `scripts` sections, and its pre-flight will FAIL if the source vault lacks this file. |

## Behavior notes for existing installed vaults (release notes)

- **`.memex/` is now gitignored** and the manifest (which embeds the interview
  answers: name, emails, paths, Drive IDs) stays machine-local. Vaults that
  committed it under older engines are migrated automatically: the next
  `memex-update prepare` runs `git rm -r --cached .memex` and the removal rides
  the update commit. The old manifest content remains in git *history*; if the
  vault pushed to a remote and that matters, rewrite history manually.
- **The launchd plist is renamed** to `com.memex.quartz.<vault-name>.plist`
  with a matching Label. The updater auto-resolves the rename (identical
  content ⇒ auto-rename), but a *loaded* LaunchAgent still points at the old
  path — `launchctl bootout` the old label and bootstrap the new plist once.
- **The auto-merge tier** now resolves clean 3-way prose merges, byte-identical
  collisions, and exact renames without writing them to the plan as unresolved;
  only genuinely conflicting edits need agent/manual review.
- **`prepare --plan` was removed** (it bypassed the in-progress-update guard);
  the plan always lives at `.memex/update-work/<run>/plan.json`.
