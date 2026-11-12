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
| `hardened/launchd/com.you.memex-quartz.plist` | `scripts/launchd/…` | Label `com.memex.quartz.{{MEMEX_LAUNCHD_ID}}` — a bake-time identity computed from the path-derived CC_PROJECT_SLUG (NOT the shareable vault name; two vaults from one answers file must not collide), `ThrottleInterval 10`, logs to `{{VAULT_PATH}}/outputs/quartz-serve.log`. In the source vault the Label literal is its own slug, which derive tokenizes. |
| `hardened/launchd/serve_quartz.sh` | `scripts/serve_quartz.sh` | Mode 755 (exec bit only; content unchanged). Note: mode-only changes do NOT propagate to already-installed vaults (the updater compares content) — `chmod +x` installed copies manually if you run the script directly; the launchd path is unaffected (plist invokes via `/bin/zsh`). |
| `hardened/quartz/quartz/cli/handlers.js` | `quartz/quartz/cli/handlers.js` | `server.listen(argv.port, "127.0.0.1")` + `WebSocketServer({ host: "127.0.0.1", … })` — serve mode includes private notes; must not bind the LAN. |
| `hardened/quartz/quartz.config.ts` | `quartz/quartz.config.ts` | `ignorePatterns` += `.memex`, `_config`, `_config/**`; `baseUrl: "localhost:<your port>"` (derive tokenizes the port literal). |
| `hardened/quartz/package.json` | `quartz/package.json` | `site:build:public` no longer sets the phantom `QUARTZ_PUBLIC_BUILD` env var (read nowhere). |
| `hardened/gitignore` | `.gitignore` | += `.claude/settings.local.json` and `.memex/` (manifest embeds the interview answers). |
| `packs/core/schemas/_types.md` | `_schemas/_types.md` | `letter`/`grant` rows annotated "*(pi pack — core-only vaults omit this type)*". |
| `packs/pi/scripts/build_cv.sh` | `scripts/build_cv.sh` | **NEW file** — `/cv-build` always referenced it but the engine never shipped it. `derive.py` now handles `scripts` sections, and its pre-flight will FAIL if the source vault lacks this file. |
| 11 skills (`lint`, `weekly-review`, `ingest-source`, `daily-briefing`, `ingest-person`, `flesh-out-idea`, `shutdown-review`, `capture-decision`, `ingest-project`; pi: `ingest-letters`, `draft-letter`) | `.claude/skills/<name>/SKILL.md` | The quartz-server start command they embed now logs to `<vault>/outputs/quartz-serve.log` instead of world-writable `/tmp/quartz-serve.log` (in the source vault the literal is the real vault path that derive tokenizes to `{{VAULT_PATH}}`). |

## Behavior notes for existing installed vaults (release notes)

- **`.memex/` is now gitignored** and the manifest (which embeds the interview
  answers: name, emails, paths, Drive IDs) stays machine-local. Vaults that
  committed it under older engines are migrated automatically: the next
  `memex-update prepare` runs `git rm -r --cached .memex` and the removal rides
  the update commit. The old manifest content remains in git *history*; if the
  vault pushed to a remote and that matters, rewrite history manually.
- **The launchd plist is renamed** to `com.memex.quartz.<path-derived-id>.plist`
  with a matching Label. Because the plist *content* also changed in this
  release (Label, log paths, ThrottleInterval), the updater classifies the old
  file as `removed-upstream` and the new one as `new` — NOT as a rename. The
  new plist installs automatically; the old one is pruned with
  `--non-interactive`/`--yes-prune`, but an interactive update's prune prompt
  defaults to "no", leaving the stale plist behind — answer yes, or delete
  `scripts/launchd/com.memex.quartz.plist` manually. A *loaded* LaunchAgent
  still points at the old path either way — `launchctl bootout` the old label
  and bootstrap the new plist once.
- **The auto-merge tier** now resolves clean 3-way prose merges, byte-identical
  collisions, and exact renames without writing them to the plan as unresolved;
  only genuinely conflicting edits need agent/manual review.
- **`prepare --plan` was removed** (it bypassed the in-progress-update guard);
  the plan always lives at `.memex/update-work/<run>/plan.json`.

# Backport checklist — 2026-07-06 bug-hunt pass

Same rule as above: these files are derive-managed, so mirror each change into
the source vault before the next `derive.py` run or it will be clobbered.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `hardened/hooks/session-start-context.sh` | `.claude/hooks/session-start-context.sh` | Task glob fixed `Ops/Tasks/Task*.md` → `Ops/Tasks/*.md` (schema names tasks `<title slug>.md`, no `Task - ` prefix — the old glob matched nothing, so "Open tasks" never rendered). Inbox count now includes dropped top-level *folders* and excludes dotfiles (`.DS_Store`) and the permanent system slots: `_*` (`_filed/`, `_journal/`) and `comms/` (per Codex review on PR #20 — `_journal/` would otherwise read as a waiting item forever). |
| `hardened/hooks/log-mutation.sh` | `.claude/hooks/log-mutation.sh` | Skip-list match is now per path segment, not substring — a note named e.g. `the_archive_pattern.md` was silently never logged. |
| `hardened/quartz/quartz/components/MemexDashboard.tsx` | `quartz/quartz/components/MemexDashboard.tsx` | Dropped `"Topic - ": "topics"` from `TYPE_PREFIX_TO_DASHBOARD` — no `dashboards/topics` page exists, so a matching value produced a 404 ↗ link. |
| `packs/core/skills/ingest-project/SKILL.md` | `.claude/skills/ingest-project/SKILL.md` | Subject question: filename is `Atlas/Projects/<Subject>.md` per `_schemas/project.md`, not `Project - <Subject>.md` (the skill contradicted the schema *and* its own Step on the artifact path). |
| `packs/core/skills/capture-comms/SKILL.md` | `.claude/skills/capture-comms/SKILL.md` | Log line actor `actor:me` → `agent:capture` (`actor:me` is not in the actor vocabulary; the skill declares it runs as `agent:capture`). |
| `packs/core/skills/reconcile-from-comms/SKILL.md` | `.claude/skills/reconcile-from-comms/SKILL.md` | Log line actor `actor:me` → `agent:librarian` (same vocabulary fix). |
| `packs/core/skills/observe-manual-patterns/SKILL.md` | `.claude/skills/observe-manual-patterns/SKILL.md` | All `actor:me` references → bare `me` (the canonical user actor — the old grep matched zero real log lines, so the observer always reported nothing); "16 hand-written skills" count dropped (core ships 24). |
| `packs/core/skills/log-mutation/SKILL.md` | `.claude/skills/log-mutation/SKILL.md` | Verb vocabulary extended with `capture`, `reconcile`, `observe`, `revisit` — four shipped skills already emit them; the closed set predated those skills. |
| `packs/core/skills/session-start/SKILL.md` | `.claude/skills/session-start/SKILL.md` | Overdue-followups grep `due:` → `surface_on:` (the followup schema has no `due:` field, so overdue followups never surfaced). |
| `packs/core/skills/lint/SKILL.md`, `packs/core/skills/daily-briefing/SKILL.md` | corresponding `.claude/skills/` | Stale "15 checks" → 20 (lint workflow numbers 1–20). |
| `packs/core/skills/triage-inbox/SKILL.md` | `.claude/skills/triage-inbox/SKILL.md` | Interaction filename order fixed to `<Person> - <Date>.md` (was reversed vs `_schemas/interaction.md`); journal routing fixed to canonical `Inbox/_journal/` (skill had inverted canon and "legacy"); Inbox listing/completion-signal exclusions now name all three system slots (`_filed/`, `_journal/`, `comms/`), not just `_filed/`. |
| `packs/core/workflows/capture-triage.md` | `_workflows/capture-triage.md` | Step 1's Inbox listing now skips all three system slots (`_filed/`, `_journal/`, `comms/`), not just `_filed/`. |
| `packs/core/workflows/lint.md` | `_workflows/lint.md` | Enum fixes: idea += `archived`, decision += `proposed` (both in the schemas), tracker += `needs_review`. |
| `packs/core/schemas/tracker.md` | `_schemas/tracker.md` | Status enum += `needs_review` — run-trackers sets it at `miss_count >= 5`, so schema+lint were false-flagging every quiet tracker. |
| `packs/core/schemas/effort.md` | `_schemas/effort.md` | Frontmatter += `superseded_by:` — the schema's own Rules require setting it on convergence but the field block lacked it. |
| `packs/pi/prompts/draft-letter.md` | `Agents/Prompts/draft-letter.md` | Steps aligned with the SKILL (7a–7c): markdown source to `outputs/letters/_src/` not `/tmp/`; delivery via `cp` to `$LETTERS_ROOT` as default with MCP `create_file` demoted to no-mount fallback; `artifact_kind: doc` → `docx` + `artifact_path`. |
| `packs/pi/skills/cv-scan/SKILL.md` | `.claude/skills/cv-scan/SKILL.md` | Description's "writes ONLY …" claim now includes the [[cv-items]] tracker bookkeeping and the followup `surface_on` bump that Step 10 actually performs. |

Hand-curated files also touched (no source-vault mirror needed): `hardened/contract/CLAUDE.base.md`
("15-check" → 20), `hardened/contract/AGENTS.base.md` (`_templates/` "one per type" claim corrected).
Engine-owned code: `tools/memex_bake.py` (scaffold `Atlas/People/{Interactions,Commitments,Asks}`
instead of the schema-contradicting `Atlas/Interactions`; `log.md` seed now carries the format
header + `---` divider the log skills anchor on).

# Backport checklist — 2026-08-11 tracker history contract

These files are derive-managed. Mirror every row into the source vault before the next
`tools/derive.py` run; otherwise derivation will remove the tracker-history and specialized-runner
protections while leaving the engine contract tests behind.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `packs/core/skills/run-trackers/SKILL.md` | `.claude/skills/run-trackers/SKILL.md` | Require one digest-linked `# History` entry per completed run, including no-material runs, and distinguish latest state from per-run provenance. |
| `packs/core/workflows/run-tracker.md` | `_workflows/run-tracker.md` | Add the history append to the canonical procedure. |
| `packs/core/prompts/run-trackers.md` | `Agents/Prompts/run-trackers.md` | Keep the pasteable prompt aligned with the canonical history contract. |
| `packs/core/schemas/tracker.md` | `_schemas/tracker.md` | Require a digest-linked history entry after every run. |
| `packs/pi/skills/cv-scan/SKILL.md` | `.claude/skills/cv-scan/SKILL.md` | Bring the specialized `[[cv-items]]` runner under the canonical digest/history contract and expand its allowed writes accordingly. |

# Backport checklist — 2026-08-11 Notion + Jira capture streams

These files are derive-managed. Mirror every row into the source vault before the next
`tools/derive.py` run; otherwise derivation will remove the Notion/Jira capture behavior while the
generated `_config/sources.md` continues to advertise the streams.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `packs/core/skills/capture-comms/SKILL.md` | `.claude/skills/capture-comms/SKILL.md` | Add read-only Notion and Jira scans: identity resolution, unfiltered bounded/paginated and timezone-safe Jira enumeration, actor-aware comment/edit/changelog classification including mention-bearing Jira field changes, explicit Notion comment-only/edit-history/resolution-provenance gaps, a source-neutral request/reply fold through read time, one Jira stateful-signal invariant with a current-assignee/current-status outcome matrix, Notion resolution reversal suppression, per-source digests, and coverage checks. |
| `packs/core/skills/reconcile-from-comms/SKILL.md` | `.claude/skills/reconcile-from-comms/SKILL.md` | Treat `↳ thread:` as a source locator and confirm Notion/Jira items through source-native read-only page/comment/edit-history or issue/comment/changelog/field reads, including live request/reply suppression, Notion resolution and Jira field-mention provenance, plus the same live Jira assignment/status fold before proposing any stateful vault change. |
| `packs/core/skills/daily-briefing/SKILL.md` | `.claude/skills/daily-briefing/SKILL.md` | Include enabled Notion/Jira activity in the default loop-closing pass and source-neutral read-only guarantees. |
| `packs/core/workflows/daily-briefing.md` | `_workflows/daily-briefing.md` | Describe Notion comments/edits and Jira assignments/comments/transitions/field mentions as capture inputs. |
| `packs/core/prompts/daily-briefing.md` | `Agents/Prompts/daily-briefing.md` | List Notion and Jira as first-class capture streams in the pasteable daily flow. |

The hand-curated installed contracts (`hardened/contract/CLAUDE.base.md` and
`hardened/contract/AGENTS.base.md`) document all five streams and their read-only guarantees.
For existing vaults, `memex-update` preserves `_config/sources.md` and inserts only missing
Notion/Jira rows as disabled; it records the migration in the update plan and archives the original
under the run's undo directory before applying it.

# Backport checklist — 2026-08-11 tracker same-day run contract

These files are derive-managed. Mirror every row into the source vault before the next
`tools/derive.py` run; otherwise derivation will remove the same-day idempotency and recovery
contract while leaving the engine contract tests behind.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `packs/core/skills/run-trackers/SKILL.md` | `.claude/skills/run-trackers/SKILL.md` | Detect recovery before eligibility filtering; preserve the authoritative discovery/plan snapshot; fail closed without a usable plan or at incomplete child workflows; create the partial digest before writes; keep direct outputs and bookkeeping idempotent; preserve cadence/miss state on broken searches; finalize last. |
| `packs/core/workflows/run-tracker.md` | `_workflows/run-tracker.md` | Define the same ordered write-ahead transaction, recovery-state classification, child boundary, and broken-run branch in the canonical procedure. |
| `packs/core/prompts/run-trackers.md` | `Agents/Prompts/run-trackers.md` | Keep the pasteable prompt aligned with recovery priority, authoritative plans, fail-closed boundaries, partial-first writes, and finalization-last. |
| `packs/core/schemas/tracker.md` | `_schemas/tracker.md` | Define one run per tracker/date, authoritative-plan recovery, safe broken-run bookkeeping, and the full output/reference/log completion predicate. |
| `packs/core/schemas/tracker_digest.md` | `_schemas/tracker_digest.md` | Define the partial write-ahead record, authoritative planning snapshot, fail-closed recovery, broken-run state, output verification, and final immutable transition. |
| `packs/core/templates/tracker_digest.md` | `_templates/tracker_digest.md` | Start new digests at `status: partial` / `plan_status: building` and include structured pre-run/planned cadence, miss-count, planned-output, and verified-output fields. |
| `packs/pi/skills/cv-scan/SKILL.md` | `.claude/skills/cv-scan/SKILL.md` | Apply the same ordered transaction and authoritative-plan recovery to `[[cv-items]]`, including the dated block and exact `Last scan window:` mutation. |
| `packs/core/skills/daily-briefing/SKILL.md` | `.claude/skills/daily-briefing/SKILL.md` | Surface fresh material tracker digests only after `status: complete`; exclude write-ahead records. |
| `packs/core/workflows/daily-briefing.md` | `_workflows/daily-briefing.md` | Apply the same completion filter in the canonical briefing input query. |
| `packs/core/prompts/daily-briefing.md` | `Agents/Prompts/daily-briefing.md` | Keep the pasteable briefing prompt aligned with the completed-digest-only consumer rule. |
| `hardened/hooks/log-mutation.sh` | `.claude/hooks/log-mutation.sh` | Exclude transaction-internal tracker digests from automatic placeholders so planning writes cannot masquerade as downstream evidence; the tracker workflow writes its authoritative log line after verification. |

# Backport checklist — 2026-08-11 single-dollar math

These Quartz files are derive-managed. Mirror every row into the source vault before the next
`tools/derive.py` run so derivation does not restore remark-math's unsafe single-dollar default.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `hardened/quartz/quartz.config.ts` | `quartz/quartz.config.ts` | Configure `Plugin.Latex` with `remarkMathOptions.singleDollarTextMath: false` so ordinary dollar amounts remain text while `$$...$$` display math continues to work. |
| `hardened/quartz/quartz/plugins/transformers/latex.ts` | `quartz/quartz/plugins/transformers/latex.ts` | Add the typed `remarkMathOptions` passthrough and preserve remark-math's existing defaults when the option is omitted. |
| `hardened/quartz/quartz/plugins/transformers/latex.test.ts` | `quartz/quartz/plugins/transformers/latex.test.ts` | Add parser-level regression coverage for default behavior, the option passthrough, the shipped config, and display math. |

# Backport checklist — 2026-11-12 briefing review

These files are derive-managed. Mirror every row into the source vault before the next
`tools/derive.py` run; otherwise derivation will drop the review items, the carry-over step, the
`apply-review` skill, and the `Inbox/reviews/` system slot while the review CLI and the engine
contract tests stay behind. Contract: `docs/superpowers/specs/2026-11-12-briefing-review-design.md`.

| Engine file changed here | Source-vault location | What to mirror |
| --- | --- | --- |
| `packs/core/skills/daily-briefing/SKILL.md` | `.claude/skills/daily-briefing/SKILL.md` | Step 2a carry-over (`briefing_review.py carryover <previous date> --json`); Step 3b writes and validates `Ops/Briefings/<date>.items.json` with the per-field rules; Step 5b opens the review on the `review_surface` surface (widget / server / page / opt-in private artifact); Step 6 makes the review form the primary answer path, hands answers to `apply-review`, and keeps "yes to 1,3" as the fallback; inbox input skips all system slots. |
| `packs/core/skills/apply-review/SKILL.md` | `.claude/skills/apply-review/SKILL.md` | **NEW skill** — saves answers from every arrival path, plans, applies by route (closes and status edits, then creations, then "Do it" work), marks each answer in the ledger, annotates §0, logs, reports. Drafts-only outbound, never self-closes on `do`. Also add it to the source vault's skill list so derive's pre-flight finds it. |
| `packs/core/workflows/daily-briefing.md` | `_workflows/daily-briefing.md` | Carry-over input, the items-file rules, validation, and the review surfaces. |
| `packs/core/prompts/daily-briefing.md` | `Agents/Prompts/daily-briefing.md` | Carry-over input (item 11), items file + validate, open the page/server review, `apply-review` for answers. |
| `packs/core/schemas/briefing.md` | `_schemas/briefing.md` | "Review items (daily)" section; §0 answered in the review or by the chat fallback; `.md` and `.items.json` regenerate together. |
| `packs/core/skills/triage-inbox/SKILL.md` | `.claude/skills/triage-inbox/SKILL.md` | `Inbox/reviews/` joins `_filed/`, `_journal/`, `comms/` as a system slot that is never listed, counted, or filed. |
| `packs/core/workflows/capture-triage.md` | `_workflows/capture-triage.md` | Same system-slot exclusion for `Inbox/reviews/`. |
| `packs/core/prompts/triage-inbox.md` | `Agents/Prompts/triage-inbox.md` | Inbox listing skips every system slot (it named only `_filed/`). |
| `packs/core/skills/session-start/SKILL.md` | `.claude/skills/session-start/SKILL.md` | Inbox count skips every system slot, including `reviews/`. |
| `hardened/hooks/session-start-context.sh` | `.claude/hooks/session-start-context.sh` | Inbox count excludes `reviews/` alongside `comms/` and `_*`. |
| `hardened/quartz/quartz/cli/handlers.js` | `quartz/quartz/cli/handlers.js` | `site:serve` routes `GET /review`, `GET /review/<date>`, `GET`/`POST /api/review/<date>` (loopback only, CSRF origin guard), shelling out to `scripts/briefing_review.py`; nothing is emitted into a static build. |
| `hardened/quartz/quartz/cli/review-routes.js` | `quartz/quartz/cli/review-routes.js` | **NEW file** — the review route implementation `handlers.js` wires in (plus its test `review-routes.test.mjs`). |
| `hardened/quartz/quartz/components/DashboardsNav.tsx` | `quartz/quartz/components/DashboardsNav.tsx` | Serve-mode-only "Review" button linking to `/review/` (full navigation, `data-router-ignore`). |
| `hardened/quartz/quartz.config.ts` | `quartz/quartz.config.ts` | `ignorePatterns` += `**/*.items.json` so briefing items never reach `public/`; comment noting `Inbox/**` covers `Inbox/reviews/`. |

Hand-curated, no source-vault mirror needed: `hardened/scripts/briefing_review.py`,
`hardened/scripts/briefing_review_app.js`, `hardened/scripts/briefing_review_app.css` (the review
CLI and its client app), and the installed contracts `hardened/contract/CLAUDE.base.md` (skills
table row, 25 core skills, `review_surface` override key, Inbox system slots) and
`hardened/contract/AGENTS.base.md` (daily-briefing paragraph, Inbox system slots). Engine-owned:
`packs.json` (`apply-review` registered), `tools/memex_bake.py` (the `_config/overrides.md` seed
documents `review_surface`; seeds are write-once, so existing vaults never get that text and every
skill treats an absent key as `auto`), `tools/test_skill_contracts.py`.
