#!/usr/bin/env bash
# memex-doctor: validate this vault's installed wiring. Most hook/serve
# failures are silent by design (hooks must never break a session) — this is
# where they become visible. Run from anywhere inside the vault:
#   scripts/memex-doctor.sh
# Exit: 0 = no FAIL findings (WARNs allowed), 1 = at least one FAIL.
#
# HAND-CURATED (like hardened/contract/): derive.py never wipes or regenerates
# hardened/scripts/ — edit this file in the engine repo directly.
set -u

VAULT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$VAULT_ROOT" || exit 1
fails=0
pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; }
failf() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

echo "memex-doctor: $VAULT_ROOT"

# 1. Hooks present + executable + wired
for h in session-start-context.sh bump-updated.sh log-mutation.sh; do
  if [ ! -f ".claude/hooks/$h" ]; then failf "hook missing: .claude/hooks/$h"
  elif [ ! -x ".claude/hooks/$h" ]; then failf "hook not executable: .claude/hooks/$h (chmod +x it)"
  else pass "hook installed: $h"; fi
  if [ -f ".claude/settings.json" ] && ! grep -q "$h" ".claude/settings.json"; then
    failf "hook not wired in .claude/settings.json: $h"
  fi
done
[ -f ".claude/settings.json" ] || failf ".claude/settings.json missing (hooks not wired)"

# 2. Required tools
for t in python3 git; do
  command -v "$t" >/dev/null 2>&1 && pass "$t available" || failf "$t not found on PATH"
done
command -v jq >/dev/null 2>&1 && pass "jq available" || warn "jq not found (bump-updated falls back to grep parsing)"
command -v node >/dev/null 2>&1 && pass "node available" || warn "node not found (Quartz site cannot serve)"

# 3. Quartz
if [ -d quartz ]; then
  [ -d quartz/node_modules ] && pass "quartz/node_modules installed" \
    || warn "quartz/node_modules missing - run: (cd quartz && npm install)"
  port="{{QUARTZ_PORT}}"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -ti ":$port" >/dev/null 2>&1; then pass "port $port in use (server likely up)"
    else warn "nothing listening on :$port (server not running; SessionStart hook will start it)"; fi
  fi
else
  warn "quartz/ missing - no local site"
fi

# 4. launchd durable-serve (macOS only, optional)
if [ "$(uname)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
  if launchctl list 2>/dev/null | grep -q "com.memex.quartz.{{MEMEX_LAUNCHD_ID}}"; then
    pass "launchd agent loaded: com.memex.quartz.{{MEMEX_LAUNCHD_ID}}"
  else
    warn "launchd agent not loaded (optional; see scripts/launchd/ to install)"
  fi
fi

# 5. Engine state
[ -f ".memex/manifest.json" ] && pass ".memex/manifest.json present" \
  || failf ".memex/manifest.json missing - updates will not work (re-run init or the reconcile prompt)"
if [ -f ".gitignore" ] && grep -q "^\.memex/$" .gitignore; then pass ".memex/ gitignored"
else warn ".memex/ not gitignored - your answers (emails, paths) could be committed"; fi
[ -f "log.md" ] && pass "log.md present" || failf "log.md missing (mutation log seed)"

echo
if [ "$fails" -gt 0 ]; then echo "doctor: $fails FAIL finding(s)"; exit 1; fi
echo "doctor: healthy (warnings above, if any, are non-fatal)"
exit 0
