#!/bin/zsh
set -e
ENG="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap "rm -rf $TMP" EXIT
fail() { echo "FAIL: $1"; exit 1; }

NEXT="$TMP/engine-next"
VAULT="$TMP/vault"
DRYVAULT="$TMP/dry-vault"
mkdir -p "$NEXT"
( cd "$ENG" && tar --exclude .git -cf - . ) | ( cd "$NEXT" && tar -xf - )

print -r -- "0.2.0" > "$NEXT/VERSION"
cat >> "$NEXT/packs/core/skills/triage-inbox/SKILL.md" <<'EOF'

Update test marker: {{OWNER_TIMEZONE}}
EOF
mkdir -p "$NEXT/packs/core/skills/update-test-new"
cat > "$NEXT/packs/core/skills/update-test-new/SKILL.md" <<'EOF'
---
name: update-test-new
description: Test-only new skill fixture.
---

# Update test new skill
EOF
rm -rf "$NEXT/packs/core/skills/observe-task-actuals"
mkdir -p "$NEXT/packs/core/skills/collision-skill"
cat > "$NEXT/packs/core/skills/collision-skill/SKILL.md" <<'EOF'
---
name: collision-skill
description: Engine collision fixture.
---

# Engine version
EOF
python3 - "$NEXT/placeholders.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
data["placeholders"].append({
    "token": "OWNER_TIMEZONE",
    "prompt": "Owner timezone",
    "example": "America/New_York",
})
path.write_text(json.dumps(data, indent=2) + "\n")
PY

"$ENG/bin/memex-init" --target "$VAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$VAULT" config user.email test@example.com
git -C "$VAULT" config user.name "Memex Test"
git -C "$VAULT" add .
git -C "$VAULT" commit -m "init" >/dev/null

cat >> "$VAULT/.claude/skills/email/SKILL.md" <<'EOF'

Local email skill edit that must survive.
EOF
mkdir -p "$VAULT/Atlas/Projects"
cat > "$VAULT/Atlas/Projects/User Data.md" <<'EOF'
# User Data

Never touch this.
EOF
mkdir -p "$VAULT/.claude/skills/collision-skill"
cat > "$VAULT/.claude/skills/collision-skill/SKILL.md" <<'EOF'
# User-owned collision file
EOF
git -C "$VAULT" add .
git -C "$VAULT" commit -m "local edits" >/dev/null

"$NEXT/bin/memex-update" --vault "$VAULT" --non-interactive --set OWNER_TIMEZONE=America/New_York >/dev/null

[ "$(git -C "$VAULT" branch --show-current)" = "engine-update-0.2.0" ] || fail "update branch not created"
grep -q "Update test marker:" "$VAULT/.claude/skills/triage-inbox/SKILL.md" || fail "untouched framework file not replaced"
grep -q "Update test marker: America/New_York" "$VAULT/.claude/skills/triage-inbox/SKILL.md" || fail "new token value not baked via --set"
[ -f "$VAULT/.claude/skills/update-test-new/SKILL.md" ] || fail "new framework file not added"
[ ! -e "$VAULT/.claude/skills/observe-task-actuals/SKILL.md" ] || fail "untouched removed-upstream file not pruned"
grep -q "Local email skill edit that must survive" "$VAULT/.claude/skills/email/SKILL.md" || fail "edited framework file was clobbered"
grep -q "Never touch this." "$VAULT/Atlas/Projects/User Data.md" || fail "user data was touched"
grep -q "User-owned collision file" "$VAULT/.claude/skills/collision-skill/SKILL.md" || fail "collision was overwritten"

PLAN="$(ls "$VAULT"/.memex/update-work/0.2.0-*/plan.json)"
python3 - "$PLAN" <<'PY'
import json, pathlib, sys
plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
counts = plan["summary"]["counts"]
assert plan["status"] == "pending", plan["status"]
assert plan["added_tokens"] == [], plan["added_tokens"]  # supplied via --set
assert counts.get("edited", 0) >= 1, counts
assert counts.get("collision", 0) >= 1, counts
assert counts.get("new", 0) >= 1, counts
assert counts.get("removed-upstream", 0) >= 1, counts
assert counts.get("replace-untouched", 0) >= 1, counts
PY

if "$NEXT/bin/memex-update" finalize --vault "$VAULT" --plan "$PLAN" >/dev/null 2>&1; then
  fail "finalize should refuse a pending unresolved plan"
fi

python3 - "$PLAN" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
plan = json.loads(path.read_text())
pending = {"edited", "removed-upstream-edited", "rename-candidate", "rename-collision", "collision"}
for entry in plan["entries"]:
    if entry.get("disposition") in pending:
        entry["resolved"] = True
        entry["resolution"] = "test-resolved"
path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n")
PY

# happy-path finalize on a clean tree must succeed, commit, and refresh state
"$NEXT/bin/memex-update" finalize --vault "$VAULT" --plan "$PLAN" >/dev/null 2>&1 || fail "happy-path finalize should succeed"
[ -n "$(git -C "$VAULT" log --oneline --grep='Update Memex engine to 0.2.0')" ] || fail "finalize did not commit the update"
python3 - "$VAULT/.memex/manifest.json" <<'PY'
import json, pathlib, sys
m = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert m["engine_version"] == "0.2.0", m["engine_version"]
assert m["answers"].get("OWNER_TIMEZONE") == "America/New_York", m["answers"].get("OWNER_TIMEZONE")
PY
grep -q "Update test marker:" "$VAULT/.memex/baseline/.claude/skills/triage-inbox/SKILL.md" || fail "baseline not refreshed to new engine"
[ -z "$(git -C "$VAULT" status --porcelain)" ] || fail "worktree should be clean after finalize"

cat > "$VAULT/Atlas/Projects/Unrelated.md" <<'EOF'
# Unrelated

This must not be swept into the update commit.
EOF
if "$NEXT/bin/memex-update" finalize --vault "$VAULT" --plan "$PLAN" >/dev/null 2>&1; then
  fail "finalize should refuse unrelated dirty files"
fi

"$ENG/bin/memex-init" --target "$DRYVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$DRYVAULT" config user.email test@example.com
git -C "$DRYVAULT" config user.name "Memex Test"
git -C "$DRYVAULT" add .
git -C "$DRYVAULT" commit -m "init" >/dev/null
DRY_BRANCH="$(git -C "$DRYVAULT" branch --show-current)"
# dry-run previews even with an unsupplied new token (no mutation), so no --set
"$NEXT/bin/memex-update" --vault "$DRYVAULT" --non-interactive --dry-run >/dev/null
[ "$(git -C "$DRYVAULT" branch --show-current)" = "$DRY_BRANCH" ] || fail "dry-run should not switch branches"
[ -z "$(git -C "$DRYVAULT" branch --list engine-update-0.2.0)" ] || fail "dry-run should not create update branch"
DRY_PLAN="$(ls "$DRYVAULT"/.memex/update-work/0.2.0-*/plan.json)"
python3 - "$DRY_PLAN" <<'PY'
import json, pathlib, sys
plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert plan["status"] == "dry-run", plan["status"]
assert plan["dry_run"] is True, plan.get("dry_run")
PY
if "$NEXT/bin/memex-update" finalize --vault "$DRYVAULT" --plan "$DRY_PLAN" >/dev/null 2>&1; then
  fail "finalize should refuse a dry-run plan"
fi

# ---------- a new non-port token with no value must refuse before mutating ----------
FAILVAULT="$TMP/fail-vault"
"$ENG/bin/memex-init" --target "$FAILVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$FAILVAULT" config user.email test@example.com
git -C "$FAILVAULT" config user.name "Memex Test"
git -C "$FAILVAULT" add .
git -C "$FAILVAULT" commit -m "init" >/dev/null
if "$NEXT/bin/memex-update" --vault "$FAILVAULT" --non-interactive >/dev/null 2>&1; then
  fail "update should refuse a new non-port token with no value"
fi
[ -z "$(git -C "$FAILVAULT" branch --list engine-update-0.2.0)" ] || fail "refused update must not create a branch"
[ -z "$(git -C "$FAILVAULT" status --porcelain)" ] || fail "refused update must not touch the worktree"
[ ! -e "$FAILVAULT/.claude/skills/update-test-new/SKILL.md" ] || fail "refused update must not add files"

# ---------- no-conflict update auto-commits (prepare commit path; covers C1) ----------
CLEANVAULT="$TMP/clean-vault"
"$ENG/bin/memex-init" --target "$CLEANVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$CLEANVAULT" config user.email test@example.com
git -C "$CLEANVAULT" config user.name "Memex Test"
git -C "$CLEANVAULT" add .
git -C "$CLEANVAULT" commit -m "init" >/dev/null
"$NEXT/bin/memex-update" --vault "$CLEANVAULT" --non-interactive --set OWNER_TIMEZONE=America/New_York >/dev/null
[ "$(git -C "$CLEANVAULT" branch --show-current)" = "engine-update-0.2.0" ] || fail "no-conflict update did not create branch"
[ -n "$(git -C "$CLEANVAULT" log --oneline --grep='Update Memex engine to 0.2.0')" ] || fail "no-conflict update did not auto-commit"
grep -q "Update test marker: America/New_York" "$CLEANVAULT/.claude/skills/triage-inbox/SKILL.md" || fail "no-conflict update did not apply engine change"
[ -z "$(git -C "$CLEANVAULT" status --porcelain)" ] || fail "no-conflict update left the worktree dirty"

# ---------- failed prepare auto-commit reports cleanly, without traceback ----------
NOCONFIGVAULT="$TMP/no-config-vault"
NOHOME="$TMP/no-git-home"
mkdir -p "$NOHOME"
"$ENG/bin/memex-init" --target "$NOCONFIGVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$NOCONFIGVAULT" add .
git -C "$NOCONFIGVAULT" -c user.email=test@example.com -c user.name="Memex Test" commit -m "init" >/dev/null
NO_CONFIG_OUT="$TMP/no-config-update.out"
if env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL -u EMAIL HOME="$NOHOME" GIT_CONFIG_NOSYSTEM=1 "$NEXT/bin/memex-update" --vault "$NOCONFIGVAULT" --non-interactive --set OWNER_TIMEZONE=America/New_York >"$NO_CONFIG_OUT" 2>&1; then
  fail "prepare auto-commit should fail without git identity"
fi
grep -q "Author identity unknown\\|unable to auto-detect email address" "$NO_CONFIG_OUT" || fail "missing controlled git identity error"
grep -q "Traceback" "$NO_CONFIG_OUT" && fail "prepare auto-commit failure should not traceback" || true
NO_CONFIG_PLAN="$(ls "$NOCONFIGVAULT"/.memex/update-work/0.2.0-*/plan.json)"
python3 - "$NO_CONFIG_PLAN" <<'PY'
import json, pathlib, sys
plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert plan["status"] == "commit-failed", plan["status"]
assert plan.get("commit_error"), plan
PY

# ---------- finalized rejected rename with absent new path should not break scoped staging ----------
RENAMEVAULT="$TMP/rename-vault"
"$ENG/bin/memex-init" --target "$RENAMEVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$RENAMEVAULT" config user.email test@example.com
git -C "$RENAMEVAULT" config user.name "Memex Test"
git -C "$RENAMEVAULT" add .
git -C "$RENAMEVAULT" commit -m "init" >/dev/null
cat > "$TMP/rejected-rename-plan.json" <<EOF
{
  "answers": {
    "GIT_MODE": "local",
    "OWNER_NAME": "Jane Roe",
    "OWNER_PRIMARY_EMAIL": "jane@example.com",
    "OWNER_FORWARDING_EMAIL": "",
    "FRAMING": "Example framing",
    "VAULT_PATH": "$RENAMEVAULT",
    "USER_HOME": "$TMP",
    "TIMEZONE": "America/New_York",
    "VAULT_NAME": "rename-vault",
    "QUARTZ_PORT": "8181",
    "QUARTZ_WS_PORT": "3101",
    "CC_PROJECT_SLUG": "-tmp-rename-vault",
    "GITHUB_ORG": "exampleorg"
  },
  "entries": [
    {
      "disposition": "rename-candidate",
      "path": ".claude/skills/email/SKILL.md",
      "new_path": ".claude/skills/rejected-rename/SKILL.md",
      "resolved": true,
      "resolution": "kept-old-path"
    }
  ],
  "packs": ["core"],
  "status": "pending"
}
EOF
"$NEXT/bin/memex-update" finalize --vault "$RENAMEVAULT" --plan "$TMP/rejected-rename-plan.json" >/dev/null 2>&1 || fail "finalize should tolerate absent rejected-rename destination"
[ ! -e "$RENAMEVAULT/.claude/skills/rejected-rename/SKILL.md" ] || fail "finalize should not create rejected rename destination"

# ---------- abort returns to the pre-update branch ----------
ABORTVAULT="$TMP/abort-vault"
"$ENG/bin/memex-init" --target "$ABORTVAULT" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null
git -C "$ABORTVAULT" config user.email test@example.com
git -C "$ABORTVAULT" config user.name "Memex Test"
git -C "$ABORTVAULT" add .
git -C "$ABORTVAULT" commit -m "init" >/dev/null
ABORT_BRANCH="$(git -C "$ABORTVAULT" branch --show-current)"
mkdir -p "$ABORTVAULT/.claude/skills/email"
printf '\nlocal edit to force a pending plan\n' >> "$ABORTVAULT/.claude/skills/email/SKILL.md"
git -C "$ABORTVAULT" add .
git -C "$ABORTVAULT" commit -m "local edit" >/dev/null
"$NEXT/bin/memex-update" --vault "$ABORTVAULT" --non-interactive --set OWNER_TIMEZONE=America/New_York >/dev/null
[ "$(git -C "$ABORTVAULT" branch --show-current)" = "engine-update-0.2.0" ] || fail "abort setup: update branch not created"
ABORT_PLAN="$(ls "$ABORTVAULT"/.memex/update-work/0.2.0-*/plan.json)"
"$NEXT/bin/memex-update" abort --vault "$ABORTVAULT" --plan "$ABORT_PLAN" >/dev/null
[ "$(git -C "$ABORTVAULT" branch --show-current)" = "$ABORT_BRANCH" ] || fail "abort did not return to the original branch"
[ -z "$(git -C "$ABORTVAULT" branch --list engine-update-0.2.0)" ] || fail "abort did not delete the empty update branch"
[ ! -e "$ABORTVAULT/.claude/skills/update-test-new/SKILL.md" ] || fail "abort did not remove an added file"
[ -e "$ABORTVAULT/.claude/skills/observe-task-actuals/SKILL.md" ] || fail "abort did not restore a pruned file"
[ -z "$(git -C "$ABORTVAULT" status --porcelain)" ] || fail "abort left the worktree dirty"

echo "PASS: memex-update safe ops + pending plan + finalize + refuse + no-conflict + abort"
