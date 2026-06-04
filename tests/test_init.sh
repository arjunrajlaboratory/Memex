#!/bin/zsh
set -e
ENG="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap "rm -rf $TMP" EXIT
fail() { echo "FAIL: $1"; exit 1; }

# tokens that MUST be fully baked away (catalogued instance tokens). Templater
# tokens (e.g. {{YYYYMMDD}}) are NOT in this list and are allowed to remain.
TOKENS=$(python3 -c "import json;print(' '.join(p['token'] for p in json.load(open('$ENG/placeholders.json'))['placeholders']))")
no_unbaked() {  # $1 = dir
  for t in $TOKENS; do
    if grep -rq "{{$t}}" "$1" 2>/dev/null; then grep -rl "{{$t}}" "$1" | head; fail "unbaked token {{$t}} in $1"; fi
  done
}

# ---------- core-only init ----------
"$ENG/bin/memex-init" --target "$TMP/core" --packs core --answers "$ENG/tests/fixtures/answers.core.json" >/dev/null

[ -d "$TMP/core/Atlas/Concepts" ] || fail "scaffold dirs missing"
[ -d "$TMP/core/Drafts" ] || fail "Drafts/ scaffold dir missing"
[ -f "$TMP/core/Drafts/README.md" ] || fail "Drafts/README.md seed missing"
[ -f "$TMP/core/.claude/skills/triage-inbox/SKILL.md" ] || fail "core skill missing"
[ -f "$TMP/core/.claude/settings.json" ] || fail "settings.json (hook wiring) missing"
[ -f "$TMP/core/.gitignore" ] || fail "vault .gitignore missing"
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
[ -d "$TMP/core/.git" ] || fail "local git mode should init a repo"
grep -q "memex-quartz" "$TMP/core/.claude/settings.json" 2>/dev/null && fail "settings.json should reference hooks not launchd" || true
no_unbaked "$TMP/core"
grep -rq "jane@example.com" "$TMP/core/.claude/skills" || fail "owner email not baked into skills"
[ ! -e "$TMP/core/.claude/skills/draft-letter" ] || fail "pi skill leaked into core init"
grep -qi "draft-letter" "$TMP/core/AGENTS.md" && fail "pi content in core contract" || true
# core contract: marker must be fully resolved (no leftover marker)
grep -q "PI_CONTRACT_FRAGMENT" "$TMP/core/AGENTS.md" "$TMP/core/CLAUDE.md" && fail "unresolved PI marker" || true

# ---------- core+pi init ----------
"$ENG/bin/memex-init" --target "$TMP/pi" --packs core,pi --answers "$ENG/tests/fixtures/answers.pi.json" >/dev/null
[ -f "$TMP/pi/.claude/skills/draft-letter/SKILL.md" ] || fail "pi skill missing in pi init"
grep -qi "draft-letter\|letter" "$TMP/pi/CLAUDE.md" || fail "pi fragment not merged into contract"
no_unbaked "$TMP/pi"
# pi port baked distinctly
grep -q "8182" "$TMP/pi/quartz/package.json" || fail "pi QUARTZ_PORT not baked"

# ---------- git mode none + calendar stream ----------
"$ENG/bin/memex-init" --target "$TMP/nogit" --packs core --answers "$ENG/tests/fixtures/answers.nogit.json" >/dev/null
[ -f "$TMP/nogit/_config/sources.md" ] || fail "_config/sources.md missing (nogit)"
grep -q "calendar: { enabled: true" "$TMP/nogit/_config/sources.md" || fail "calendar stream not enabled when requested"
grep -q "git_mode: none" "$TMP/nogit/_config/sources.md" || fail "git_mode none not recorded"
[ ! -d "$TMP/nogit/.git" ] || fail "git mode none should NOT init a repo"

# ---------- guards ----------
"$ENG/bin/memex-init" --target "$TMP/core" --packs core --answers "$ENG/tests/fixtures/answers.core.json" 2>/dev/null && fail "should refuse non-empty target" || true

echo "PASS: memex-init core + pi + sources/git + guards"
