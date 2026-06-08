# One-time prompt: reconcile a pre-manifest local vault with the canonical engine

Use this only for a maintainer vault that predates `.memex/manifest.json`. It bootstraps the vault into the normal update system; after this succeeds, future changes should use `/update`.

## Prompt

You are reconciling a local Memex vault with the now-canonical memex-engine repo. The local vault has no `.memex/manifest.json` and no `.memex/baseline/`, so the normal update command cannot reason about local edits yet.

Inputs:

- Engine repo: `<ENGINE_DIR>`
- Local vault: `<VAULT_DIR>`
- Answers file containing the maintainer's real instance facts: `<ANSWERS_JSON>`
- Packs installed in the local vault, usually `core` or `core,pi`: `<PACKS>`

Hard rules:

- Never touch `Atlas/`, `Ops/`, `Inbox/`, `Drafts/`, `outputs/`, `Raw/`, or other user data.
- Framework paths are `.claude/skills/`, `_schemas/`, `_templates/`, `_workflows/`, `Agents/Prompts/`, `scripts/`, `quartz/`, `AGENTS.md`, and `CLAUDE.md`.
- Preserve genuinely newer or intentionally divergent local framework content.
- Adopt engine fixes the local vault is missing.
- Ask on real conflicts; do not silently choose.

Procedure:

1. Create a temporary baked engine tree:

   ```bash
   python3 <ENGINE_DIR>/tools/memex_init.py --eng <ENGINE_DIR> --target /tmp/memex-reconcile-baked --packs <PACKS> --answers <ANSWERS_JSON> --force
   ```

   This produces literal-for-literal framework files using the maintainer's real answers.

2. Compare the baked framework tree to the local vault path by path. Ignore all user data paths. For every framework file:

   - If the baked engine has a file the local vault lacks, adopt it unless there is a user-created collision at the same path.
   - If the local vault has a framework file the engine removed, ask whether to keep, archive, or delete.
   - If both have the file, inspect the diff. Adopt missing engine fixes while preserving local improvements. For prose, merge intent. For code/config, ask before choosing or hand-merging.
   - For likely renames, confirm with the maintainer before moving content.

3. After reconciliation, stamp the local vault as a first-class installed vault:

   ```bash
   python3 <ENGINE_DIR>/tools/memex_update.py finalize --eng <ENGINE_DIR> --vault <VAULT_DIR> --plan <PLAN_JSON> --no-git-commit
   ```

   Use `--no-git-commit` because step 2 may have intentionally adopted framework changes before the vault has an update plan; the single reconciliation commit happens in step 4. If no normal update plan exists yet, create a minimal temporary plan JSON containing:

   ```json
   {
     "answers": { "...": "from <ANSWERS_JSON>" },
     "packs": ["core"],
     "status": "complete"
   }
   ```

   Use the real pack list. The finalize step writes `.memex/manifest.json`, refreshes `.memex/baseline/`, and appends the local baseline ignore rules to `.gitignore`.

4. Commit the reconciliation in the local vault. The review surface should show framework changes plus `.memex/manifest.json`, while `.memex/baseline/` remains ignored.

Report:

- Engine files adopted.
- Local framework edits preserved.
- Conflicts asked and resolved.
- Files kept as local forks.
- Confirmation that `.memex/manifest.json` and `.memex/baseline/` now exist.
