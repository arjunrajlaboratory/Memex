---
name: update
description: Update this installed Memex vault from a newer memex-engine checkout without silently overwriting local framework edits. Use when the user says "update Memex", "pull engine updates", "upgrade this vault", "sync from the engine", "adopt the latest skills/schemas/templates/quartz", or invokes "/update". Runs the deterministic memex-update prepare step, reviews the generated plan, carries prose edits onto the new engine base when safe, asks on conflicts/code/config/collisions/renames, then finalizes the manifest and baseline.
---

# Update this vault from the engine

You are running as **`agent:auditor` + `agent:librarian`** for a framework update. Your job is to adopt the newer engine while preserving the user's data and never silently discarding local framework edits.

## Inputs

- **Engine directory**: ask for it if the user did not provide it and neither `MEMEX_ENGINE_DIR` nor a `memex-update` executable on `PATH` resolves cleanly.
- **Vault directory**: default `{{VAULT_PATH}}` or the current working directory if this skill is invoked inside the vault.

## Step 0 - Orient

Read:

- `AGENTS.md`
- `.memex/manifest.json`
- `_config/overrides.md` if present

If `.memex/manifest.json` is missing, stop. This vault predates update tracking; use the one-time reconciliation prompt from the engine repo instead of the normal update path.

## Step 1 - Run the deterministic prepare step

Resolve the command in this order:

1. If the user gave an engine path: `python3 <engine>/tools/memex_update.py --eng <engine> --vault <vault> --non-interactive`
2. Else if `MEMEX_ENGINE_DIR` is set: `python3 "$MEMEX_ENGINE_DIR/tools/memex_update.py" --eng "$MEMEX_ENGINE_DIR" --vault <vault> --non-interactive`
3. Else if `memex-update` is on `PATH`: `memex-update --vault <vault> --non-interactive`
4. Else ask for the engine directory.

The tool will:

- refuse a dirty git worktree when git mode is enabled,
- create/switch to `engine-update-<version>` when git mode is enabled,
- replace only untouched framework files,
- add new framework files unless they collide with user-created paths,
- seed missing seed files,
- prune untouched files removed upstream,
- write a plan under `.memex/update-work/<version>-<timestamp>/plan.json`.

Read the plan JSON before editing anything else.

### New engine tokens

If prepare exits with `error: the newer engine added token(s) with no value: …`, the newer engine introduced instance-fact placeholders (e.g. a new email or path) that would otherwise bake blank. Do not pass `--allow-blank-tokens` to silence it. Instead, ask the user for each named token's value, then re-run the same prepare command adding `--set TOKEN=VALUE` for each. Only proceed once prepare runs without that error (the plan's `added_tokens` then reflects what was filled). Port tokens carry safe defaults and never block.

## Step 2 - Resolve pending plan entries

For each entry whose `disposition` is one of `edited`, `removed-upstream-edited`, `rename-candidate`, `rename-collision`, or `collision`, use the artifact paths in the plan:

- `baseline_path`: the old baked engine ancestor
- `current_path`: the user's current vault file
- `staged_path`: the new baked engine file

If git mode is `none`, copy the real current vault file to `<path>.bak` before changing any unresolved edited/collision file. Do not create bulk backups for safe replacements; those are recoverable from `.memex/baseline/`.

### Prose framework files

For `kind: prose`, perform an intent-preserving 3-way merge:

1. Identify exactly what the user changed from `baseline_path` to `current_path`.
2. Start from `staged_path`.
3. Carry the user's intent onto the new base.
4. Ask the user only when the engine change and user change conflict.
5. Report each user edit as kept, merged, or dropped-with-reason.

Write the merged result to the real vault path after review.

### Code/config framework files

For `kind: code`, do not auto-merge. Show the relevant diff/context and ask the user to choose:

- keep mine
- take engine
- hand-merge

For `.claude/settings.json`, treat it as code/config for now. Do not invent a structured JSON merge.

### Removed upstream, edited locally

Ask whether to:

- keep the file as a local fork,
- archive it under `_archive/<original-path>`,
- delete it.

Never delete an edited file without explicit confirmation.

### Rename candidates

Ask the user to confirm the rename. If the old file was edited, carry the local edit onto the renamed `staged_path` using the prose/code rules above. When confirmed, create the new path and archive or remove the old path according to the user's choice.

### Rename collisions

A `rename-collision` means the engine likely renamed an old framework path to a path the user already created. Use `collision_path` to inspect the user's existing destination file. Ask whether to keep the user destination file, move it aside, hand-merge, or take the engine rename. Never overwrite the destination without an explicit choice.

### Collisions

An engine file now wants a path the user already created. Ask whether to keep the user file, take the engine file, move one side, or hand-merge.

## Step 3 - Finalize

Before finalizing, update the plan JSON so every handled pending entry has `"resolved": true` plus a short `"resolution"` string (`"merged"`, `"kept-local"`, `"took-engine"`, `"archived-old"`, etc.). The deterministic finalizer refuses pending unresolved entries.

After all pending entries are resolved, run:

```bash
python3 <engine>/tools/memex_update.py finalize --eng <engine> --vault <vault> --plan <plan.json>
```

This refreshes `.memex/manifest.json` and `.memex/baseline/`. When git mode is enabled, it commits the update branch.

## Aborting

If the user decides to abandon the update mid-merge (git mode enabled), return the vault to its pre-update state:

```bash
python3 <engine>/tools/memex_update.py abort --vault <vault> --plan <plan.json>
```

This reverts the deterministic-safe changes (scoped to the plan's paths, so unrelated work is untouched), removes the staging work dir, and switches back to the branch the update started from — deleting the empty `engine-update-<version>` branch.

## Step 4 - Report back

Summarize:

- engine version before -> after,
- safe replacements/additions/removals,
- local edits merged or intentionally kept,
- unresolved questions asked and their answers,
- branch or sidecar location for review,
- the exact plan path.

End by telling the user the review surface: `git diff main...engine-update-<version>` when git is enabled, or the written plan/report when git mode is `none`.
