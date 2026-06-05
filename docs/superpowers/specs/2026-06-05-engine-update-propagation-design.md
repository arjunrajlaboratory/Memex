# Design: engine update propagation to installed vaults

**Date:** 2026-06-05
**Status:** draft (awaiting review)
**Deferred item resolved:** README "Not yet done" → *upstream-update merge UX*

## Problem

A vault is created once by `memex_init.py`, which bakes engine files (`{{TOKENS}}` →
answers) into the target. After that there is **no path to pull in a newer engine
version**. The only re-run option is `--force`, which *overlays* — re-bakes every
engine file on top of the vault, silently clobbering any local edits, never deleting
files removed upstream, and never handling renames. Meanwhile the README actively
invites users to "edit any skill to suit your flow." Those two facts collide: the
moment the engine ships a new skill/schema/fix, the user has no safe way to adopt it.

There is also no record in a vault of *what* was installed — no engine version, no
manifest, no content fingerprints — so nothing can reason about what changed.

## Goal / success criteria

A user on an older engine can run one command and:

1. Adopt new and changed framework files (skills, schemas, templates, prompts,
   workflows, hooks, quartz, contract) from a newer engine version.
2. **Never lose their own data** (`Atlas/`, `Ops/`, `Inbox/`, etc.) — those dirs are
   never touched.
3. **Never silently lose a local edit** to a framework file. Untouched files are
   replaced; edited files are merged with their intent preserved, or surfaced for a
   decision — never overwritten without the user seeing it.
4. Get a **reviewable result** (a git diff / branch, or sidecar files when git is off)
   and a one-line summary of what happened.
5. Have the new engine version, answers, and file fingerprints recorded so the *next*
   update can reason the same way.

## Scope

**In scope:** the engine → installed-vault boundary (call it Layer 1 → Layer 2):
ownership model, in-vault manifest + baseline, the `update` flow (a deterministic
Python core + an LLM-driven skill), and the convention/doc changes that make framework
files read-only-by-default with `_config/` overrides.

**Explicitly out of scope (decided):** the *ongoing* maintainer-side source-vault →
engine discipline (a `check_derive_drift.py` guard, a re-derive contract). The engine
repo is treated as canonical going forward; the maintainer's personal source vault is
reconciled out-of-band. **One concrete deliverable does fall in scope**, however: a
*one-time* LLM-driven reconciliation prompt to bring the maintainer's existing local
vault in line with the now-canonical engine (see "One-time deliverable" below).

**Also out of scope (YAGNI):** cross-machine sync of the baseline cache; adding or
removing *packs* during an update (a separate op); structured auto-merge of
`settings.json` (ask-based instead); rollback beyond `git revert`.

## Ownership model

Every path a vault contains has exactly one class. Classes are declared once in the
engine (`engine_layout.json`, below) and stamped per-file into each vault's manifest at
init, so init and update agree.

- **Framework (engine-owned).** Replaceable; read-only by convention.
  - *prose:* `.claude/skills/**`, `_schemas/**`, `_templates/**`, `_workflows/**`,
    `Agents/Prompts/**`, and the contract `AGENTS.md` / `CLAUDE.md`.
  - *code/config:* `quartz/**` (source only), `.claude/hooks/**`,
    `.claude/settings.json`, `scripts/**`.
- **User data (never touched).** `Atlas/**`, `Ops/**`, `Agents/{Jobs,Runs,Approvals}/**`,
  `Inbox/**`, `Drafts/**`, `outputs/**`, `Raw/**`.
- **Seed (write-once).** Files init creates as a starting point but the user owns after:
  `index.md`, `log.md`, `_config/sources.md`, `_config/overrides.md`, the `README.md`
  stubs. Update **seeds only if absent**; it never overwrites a seed.
- **Overrides.** There is no plugin runtime — "framework" is just markdown the agent
  reads — so an override is a **precedence rule, not a merge**. Behavioral
  customization lives in `_config/` (the existing `sources.md` seam, plus a new general
  `_config/overrides.md`), and the contract instructs the agent to honor `_config/`
  over framework defaults. A genuine in-place edit to a framework file is *not* an
  override — it is a fork, detected by the manifest and handled by the merge path.

**Authority rule (keeps update simple):** the **manifest is per-file authoritative**.
At update time, a path's class is whatever the manifest recorded. Any path *not* in the
manifest is user content and is never touched. `engine_layout.json` is consulted only
at install/record time to assign classes to engine files. This sidesteps glob-precedence
ambiguity at update time (e.g. `_config/sources.md` is a seed even though it sits under
the `_config/**` data tree).

## Versioning, manifest, baseline

### Engine version
Add a top-level `VERSION` file (semver) to the engine repo. The manifest records both
the version string and the git commit it was built from, so updates are legible
("0.3.0 → 0.5.0") and the ancestor is precisely identifiable.

### `engine_layout.json` (new, in engine repo)
Single source of truth for the ownership classes, consumed by both `memex_init.py` and
`memex_update.py`:

```json
{
  "framework": {
    "prose": ["_schemas/**", "_templates/**", "_workflows/**",
              "Agents/Prompts/**", ".claude/skills/**", "AGENTS.md", "CLAUDE.md"],
    "code":  ["quartz/**", ".claude/hooks/**", ".claude/settings.json", "scripts/**"]
  },
  "seed": ["index.md", "log.md", "_config/sources.md", "_config/overrides.md",
           "Inbox/README.md", "outputs/README.md", "Drafts/README.md"],
  "data": ["Atlas/**", "Ops/**", "Agents/Jobs/**", "Agents/Runs/**",
           "Agents/Approvals/**", "Inbox/**", "Drafts/**", "outputs/**",
           "Raw/**"]
}
```

### `.memex/manifest.json` (new, in each vault, **git-tracked**)
Stamped at init, refreshed after each successful update:

```json
{
  "engine_version": "0.4.0",
  "engine_commit": "31e8454",
  "installed_at": "2026-06-05",
  "updated_at": "2026-06-05",
  "packs": ["core", "pi"],
  "answers": { "OWNER_NAME": "…", "QUARTZ_PORT": "…",
               "STREAMS": ["email","slack"], "GIT_MODE": "local" },
  "files": {
    ".claude/skills/triage-inbox/SKILL.md":
        { "sha256": "…", "class": "framework", "kind": "prose", "pack": "core" },
    "index.md":
        { "sha256": "…", "class": "seed", "kind": "prose", "pack": null }
  }
}
```

Storing `answers` lets update **re-bake the new engine without re-interviewing**. This
adds no new exposure — those instance facts are already baked into every framework file
in the vault.

### `.memex/baseline/` (new, in each vault, **gitignored** local cache)
A verbatim copy of every framework file *as baked* at the last install/update. It is the
**common ancestor** for 3-way merges. Gitignored (it duplicates content and would bloat
diffs); if it is missing (e.g. a vault cloned to a new machine), update **reconstructs**
the ancestor by checking out `engine_commit` from the engine repo and re-baking. Init
adds `.memex/baseline/` to the vault `.gitignore` (and tracks `.memex/manifest.json`).

## Update flow

Two pieces, matching the repo's Python-tool + markdown-skill idiom: a deterministic core
that classifies and applies the safe operations, and an LLM-driven skill that does the
judgement work (prose merges, conflict questions).

### `tools/memex_update.py` — deterministic core

Inputs: engine dir (newer), vault dir. Steps:

1. Read `<vault>/.memex/manifest.json`. Read the new engine's `VERSION`,
   `placeholders.json`, `engine_layout.json`, `packs.json`.
2. **New-token check.** Tokens in the new `placeholders.json` absent from
   `manifest.answers` are collected. Interactive: prompt for just those (example as
   default). Non-interactive: fill from example/blank via the existing
   `answers_with_defaults` logic. Merge into the working answers set.
3. Re-bake the new engine for the manifest's pack set into a temp **staging tree**
   (reuse `memex_init`'s `bake`/`bake_tree`; refactor the shared baking helpers into an
   importable module so update and init don't duplicate logic).
4. Ensure the **baseline** ancestor is available (use `.memex/baseline/`, else
   reconstruct from `engine_commit`).
5. **Classify** every framework path by comparing three versions — *baseline*
   (ancestor) vs *vault-current* (user) vs *staged-new* (engine):
   - **untouched** — vault matches baseline → safe to replace.
   - **edited** — vault differs from baseline → needs merge (route by `kind`).
   - **new** — in staged-new, not in manifest → add (special-case: if the vault already
     has a user file at that path, mark **collision → ask**).
   - **removed-upstream** — in manifest, not in staged-new.
   - **rename-candidate** — a removed path whose content closely matches a new path
     (content-similarity heuristic); recorded for the skill/user to confirm.
6. **Apply the deterministic-safe operations** directly: replace *untouched*, add *new*,
   *seed-if-absent* for seed files, batch-confirm prune of *untouched removed-upstream*.
   **Do not** perform prose merges or touch *edited* files.
7. Emit a JSON **plan** describing every disposition, with the three staged paths for
   each *edited* / *rename-candidate* / *collision* file, for the skill to act on.

The core is pure file/hash logic → unit-testable in isolation.

### `update` skill (`packs/core/skills/update/SKILL.md`) — judgement layer

The agent-facing entry, run inside the vault. It invokes the core, applies the safe ops,
then resolves the remaining set, routing **by kind**:

- **prose** (skills/schemas/templates/prompts/contract): a **3-way intent-preserving
  merge** from {baseline, vault-current, staged-new}. The agent reads all three, carries
  the *intent* of the user's edit onto the new base, and **asks the user only on genuine
  conflicts**. It reports, per file, each detected user edit and how it was carried
  (kept / merged / dropped-because) so nothing is silently lost.
- **code/config** (`quartz/`, hooks, `settings.json`): **no auto-merge.** Show the diff
  (with the ancestor for context) and ask *keep-mine / take-engine / hand-merge*.
- **removed-upstream, edited**: ask *keep / archive / delete* (never auto-delete an
  edited file).
- **rename-candidate**: the agent/user confirms the rename; if the old file was edited,
  the edit is carried onto the renamed file (3-way against the rename).
- **collision** (engine now ships a path the user already created): ask.

### Reviewability and safety

- **git on:** refuse on a dirty working tree (ask the user to commit/stash first). Apply
  changes onto an `engine-update-<version>` branch and commit, so the user reviews a
  single `git diff` and can revert atomically or merge after review.
- **git off (`git_mode: none`):** write `.bak` sidecars for *merged/edited* files only
  (not bulk replaces — those are recoverable from the baseline), plus a written summary
  report. The baseline snapshot is the recovery point.
- On success, **refresh** `.memex/baseline/` and `.memex/manifest.json` (new version,
  commit, answers, file hashes).

A run reports, e.g.: *"21 unchanged → replaced · 3 you edited → merged (1 needed your
input) · 1 removed upstream → pruned · 2 new → added · 1 new token → prompted. Review on
branch `engine-update-0.5.0`."*

## Init changes (`memex_init.py`)

- After baking, write `.memex/manifest.json` (version from engine `VERSION`, commit,
  packs, the full answers set including `STREAMS`/`GIT_MODE`, and per-file
  `{sha256, class, kind, pack}` derived from `engine_layout.json`).
- Write the `.memex/baseline/` snapshot (verbatim baked framework files).
- Append `.memex/baseline/` to the vault `.gitignore`; ensure `.memex/manifest.json`
  stays tracked.
- Add `_config/overrides.md` as a new seed file.
- Refactor the shared baking helpers (`bake`, `strip_sections`, `bake_tree`,
  `answers_with_defaults`, the location map) into an importable module so
  `memex_update.py` reuses them rather than duplicating.

## Convention / documentation changes

- **README:** replace the "edit any skill to suit your flow" framing with the ownership
  model — framework files are engine-owned and updated; customization goes in `_config/`
  overrides; in-place edits are tolerated but will surface at update time. Document the
  `update` command, and move *upstream-update merge UX* out of "Not yet done."
- **Contract** (`hardened/contract/CLAUDE.base.md`, `AGENTS.base.md`): add a short
  "Framework vs. your edits" rule and the `_config/` precedence convention (the agent
  honors `_config/overrides.md` over framework defaults).

## Testing

- **Unit (`tools/test_memex_update.py`):** classification over synthetic
  {baseline, user, new} trees — untouched / edited / new / removed / rename-candidate /
  collision; new-token detection; seed-if-absent.
- **Integration (`tests/test_update.sh`):** init a vault → simulate an engine bump
  (change a skill's prose, add a file, remove a file, rename a file, add a new
  `{{TOKEN}}`) → edit one framework prose file and one data note in the vault → run
  update non-interactively → assert: untouched replaced, edited framework file flagged
  for merge (not clobbered), data note untouched, new file added, removed file pruned,
  rename surfaced, new token prompted/defaulted, manifest + baseline refreshed, and
  (git mode) a clean `engine-update-*` branch exists.
- `python3 tools/audit_literals.py ./packs` and `./hardened` → must stay AUDIT CLEAN.
- `(cd tools && python3 -m unittest)` and the existing `tests/test_init.sh` still pass
  (init now also writes `.memex/`).

## One-time deliverable: local-vault reconciliation prompt

The maintainer's personal source vault predates this system: it has **no
`.memex/manifest.json` and no baseline**, and it currently *lags* the engine (e.g. it
is missing the safe_title wiring that was made directly in `packs/`). It also holds its
own genuinely-newer local content. So the normal `update` path cannot run against it —
there is no recorded ancestor to diff from.

Ship a **one-shot, hand-run reconciliation prompt** (e.g.
`tools/prompts/reconcile-local-vault.md`) for the maintainer to paste into Claude Code
pointed at both the engine repo and the local vault. It is a *bootstrap*, not the
ongoing derive discipline (explicitly out of scope). It must:

1. Bake the engine's framework files with the maintainer's **real** instance facts (so
   the comparison is literal-for-literal, not token-vs-literal), into a temp tree.
2. Walk the diff between that baked-engine framework and the local vault's corresponding
   files, file by file, using judgement: **adopt** engine changes the local vault is
   missing (the safe_title wiring, etc.), while **preserving** anything the local vault
   has that is genuinely newer or intentionally divergent — asking the maintainer on any
   real conflict (the same intent-preserving + ask-on-conflict contract as the user
   `update` skill).
3. On completion, **stamp a `.memex/manifest.json` + baseline into the local vault** so
   that from then on it is a first-class installed vault and future updates use the
   normal `update` path — retiring the special case permanently.

This is the concrete form of "I'll have an LLM go over the diff and update my local
mind-map," captured so it is not lost as a thing-to-remember.

## Open questions / future work

- **Pack add/remove on update** — deferred to a separate op.
- **`settings.json` structured merge** — ask-based for now; a JSON-aware merge could be
  added later.
- **Rename heuristic threshold** — start with a high content-similarity bar and let the
  user confirm; tune from real updates.
