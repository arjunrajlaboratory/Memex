#!/bin/zsh
set -e
ENG="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# tokens that MUST be fully baked away (catalogued instance tokens). Templater
# tokens (e.g. {{YYYYMMDD}}) are NOT in this list and are allowed to remain.
TOKENS=$(python3 -c "import json;print(' '.join(p['token'] for p in json.load(open('$ENG/placeholders.json'))['placeholders']))")
no_unbaked() {  # $1 = dir
  for t in ${=TOKENS}; do
    if grep -rq "{{$t}}" "$1" 2>/dev/null; then grep -rl "{{$t}}" "$1" | head; fail "unbaked token {{$t}} in $1"; fi
  done
}

# Self-test: the gate must actually fire — guards against the zsh word-splitting
# regression that silently made this gate vacuous.
SELFTEST="$TMP/selftest"; mkdir -p "$SELFTEST"; echo '{{OWNER_NAME}}' > "$SELFTEST/x.md"
if (no_unbaked "$SELFTEST") >/dev/null 2>&1; then
  fail "no_unbaked gate is vacuous (did not flag a planted token)"
fi
rm -rf "$SELFTEST"

# General optional-token regression gate: a blank optional answer must drop its
# surrounding prose via {{?TOKEN}}…{{/TOKEN}} sections, NOT bake an empty `` pair
# (or a dangling clause). Scans for empty inline-code that is not part of a ```
# fence. Uses python3 (already a test dep) since BSD grep lacks lookarounds.
no_empty_inline_code() {  # $1 = dir
  python3 - "$1" <<'PY'
import sys, pathlib, re
root, pat, bad = pathlib.Path(sys.argv[1]), re.compile(r"(?<!`)``(?!`)"), []
for fp in root.rglob("*.md"):
    for i, ln in enumerate(fp.read_text(errors="ignore").splitlines(), 1):
        if pat.search(ln):
            bad.append(f"{fp}:{i}: {ln.strip()}")
if bad:
    print("\n".join(bad)); sys.exit(1)
PY
}

# ---------- core-only init ----------
"$ENG/bin/memex-init" --target "$TMP/core" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null

[ -d "$TMP/core/Atlas/Concepts" ] || fail "scaffold dirs missing"
[ -d "$TMP/core/Drafts" ] || fail "Drafts/ scaffold dir missing"
[ -f "$TMP/core/Drafts/README.md" ] || fail "Drafts/README.md seed missing"
[ -f "$TMP/core/_config/overrides.md" ] || fail "_config/overrides.md seed missing"
[ -f "$TMP/core/.claude/skills/triage-inbox/SKILL.md" ] || fail "core skill missing"
[ -f "$TMP/core/.claude/settings.json" ] || fail "settings.json (hook wiring) missing"
[ -x "$TMP/core/.claude/hooks/bump-updated.sh" ] || fail "bump-updated hook not executable"
[ -x "$TMP/core/.claude/hooks/log-mutation.sh" ] || fail "log-mutation hook not executable"
[ -x "$TMP/core/.claude/hooks/session-start-context.sh" ] || fail "session-start hook not executable"
python3 - "$TMP/core/.claude/settings.json" <<'PY' || fail "hook settings should be bash-wrapped"
import json, pathlib, sys
settings = json.loads(pathlib.Path(sys.argv[1]).read_text())
commands = {
    hook["command"]
    for group in settings["hooks"].values()
    for entry in group
    for hook in entry["hooks"]
}
expected = {
    'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/bump-updated.sh"',
    'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/log-mutation.sh"',
    'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-context.sh"',
}
assert expected <= commands, sorted(commands)
PY
[ -f "$TMP/core/.gitignore" ] || fail "vault .gitignore missing"
[ -f "$TMP/core/.memex/manifest.json" ] || fail ".memex/manifest.json missing"
[ -f "$TMP/core/.memex/baseline/.claude/skills/triage-inbox/SKILL.md" ] || fail "framework baseline missing"
grep -q ".memex/baseline/" "$TMP/core/.gitignore" || fail "baseline should be gitignored"
grep -q ".memex/update-work/" "$TMP/core/.gitignore" || fail "update workdir should be gitignored"
[ -f "$TMP/core/AGENTS.md" ] || fail "AGENTS.md missing"
[ -f "$TMP/core/CLAUDE.md" ] || fail "CLAUDE.md missing"
[ -f "$TMP/core/scripts/serve_quartz.sh" ] || fail "serve_quartz.sh not at scripts/"
[ -f "$TMP/core/scripts/launchd/com.memex.quartz.plist" ] || fail "launchd plist missing/misnamed"
# sources config seed: present, default streams (email+slack on, calendar off), local git
[ -f "$TMP/core/_config/sources.md" ] || fail "_config/sources.md seed missing"
grep -q "email: { enabled: true" "$TMP/core/_config/sources.md" || fail "email stream not enabled by default"
grep -q "slack: { enabled: true" "$TMP/core/_config/sources.md" || fail "slack stream not enabled by default"
grep -q "calendar: { enabled: false" "$TMP/core/_config/sources.md" || fail "calendar should default off"
grep -q "git_mode: local" "$TMP/core/_config/sources.md" || fail "default git_mode should be local"
grep -q 'gmail_connected: "jane@example.com"' "$TMP/core/_config/sources.md" || fail "connected mailbox not recorded"
grep -q 'other_sending_accounts: \[\]' "$TMP/core/_config/sources.md" || fail "blank sending accounts should bake empty list"
[ -d "$TMP/core/.git" ] || fail "local git mode should init a repo"
grep -q "memex-quartz" "$TMP/core/.claude/settings.json" 2>/dev/null && fail "settings.json should reference hooks not launchd" || true
no_unbaked "$TMP/core"
# blank OWNER_FORWARDING_EMAIL: optional-token prose must DROP, not bake empties
no_empty_inline_code "$TMP/core/.claude/skills" || fail "empty inline-code (optional token baked blank) in core skills"
grep -qF "forwards into it" "$TMP/core/.claude/skills/email/SKILL.md" && fail "blank-forwarding clause not dropped from email skill" || true
grep -qF "Gmail MCP searches only the connected mailbox" "$TMP/core/.claude/skills/email/SKILL.md" || fail "email skill should state connected mailbox boundary"
grep -qF "inconclusive access-gap evidence" "$TMP/core/.claude/skills/email/SKILL.md" || fail "email skill should treat non-connected sends as inconclusive"
grep -rq "jane@example.com" "$TMP/core/.claude/skills" || fail "owner email not baked into skills"
[ ! -e "$TMP/core/.claude/skills/draft-letter" ] || fail "pi skill leaked into core init"
[ -f "$TMP/core/.claude/skills/update/SKILL.md" ] || fail "update skill missing in core init"
grep -qi "draft-letter" "$TMP/core/AGENTS.md" && fail "pi content in core contract" || true
# core contract: marker must be fully resolved (no leftover marker)
grep -q "PI_CONTRACT_FRAGMENT" "$TMP/core/AGENTS.md" "$TMP/core/CLAUDE.md" && fail "unresolved PI marker" || true
python3 - "$TMP/core/.memex/manifest.json" <<'PY'
import json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert manifest["engine_version"]
assert manifest["answers"]["GIT_MODE"] == "local"
assert manifest["answers"]["STREAMS"] == ["email", "slack"]
assert manifest["files"][".claude/skills/update/SKILL.md"]["class"] == "framework"
assert manifest["files"]["_config/overrides.md"]["class"] == "seed"
PY

# ---------- core+pi init ----------
"$ENG/bin/memex-init" --target "$TMP/pi" --packs core,pi --answers "$ENG/tests/fixtures/answers.pi.json" >/dev/null
[ -f "$TMP/pi/.claude/skills/draft-letter/SKILL.md" ] || fail "pi skill missing in pi init"
grep -qi "draft-letter\|letter" "$TMP/pi/CLAUDE.md" || fail "pi fragment not merged into contract"
no_unbaked "$TMP/pi"
# set OWNER_FORWARDING_EMAIL: the optional clause + hedge bake in (the kept branch)
grep -qF '`jane@example.edu` forwards received mail into it' "$TMP/pi/.claude/skills/email/SKILL.md" || fail "forwarding visibility clause not baked when set"
grep -qF 'Other sending accounts the user may use: `jane@lab.example.edu,jane@hospital.example.org`' "$TMP/pi/.claude/skills/email/SKILL.md" || fail "sending accounts clause not baked when set"
grep -qF 'other_sending_accounts: ["jane@lab.example.edu", "jane@hospital.example.org"]' "$TMP/pi/_config/sources.md" || fail "sending accounts not normalized into sources config"
# pi port baked distinctly
grep -q "8182" "$TMP/pi/quartz/package.json" || fail "pi QUARTZ_PORT not baked"

# ---------- git mode none + calendar stream ----------
"$ENG/bin/memex-init" --target "$TMP/nogit" --packs core --answers "$ENG/tests/fixtures/answers.nogit.json" >/dev/null
[ -f "$TMP/nogit/_config/sources.md" ] || fail "_config/sources.md missing (nogit)"
grep -q "calendar: { enabled: true" "$TMP/nogit/_config/sources.md" || fail "calendar stream not enabled when requested"
grep -q "git_mode: none" "$TMP/nogit/_config/sources.md" || fail "git_mode none not recorded"
grep -q 'other_sending_accounts: \["jane@clinic.example.org"\]' "$TMP/nogit/_config/sources.md" || fail "nogit sending account not recorded"
[ ! -d "$TMP/nogit/.git" ] || fail "git mode none should NOT init a repo"

# ---------- guards ----------
"$ENG/bin/memex-init" --target "$TMP/core" --packs core --answers "$ENG/tests/fixtures/answers.core.json" 2>/dev/null && fail "should refuse non-empty target" || true

echo "PASS: memex-init core + pi + sources/git + guards"
