#!/bin/zsh
set -e
ENG="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

HOOK_SRC="$ENG/hardened/hooks/log-mutation.sh"
[ -f "$HOOK_SRC" ] || fail "log-mutation.sh source missing"

# --- Regression guard for issue #13 (cross-platform) -------------------------
# The hook must NOT build its Python via a heredoc nested in $() (`-c "$(cat
# << ...)"`). macOS's system bash 3.2 does not skip heredoc bodies when scanning
# for the closing `)`, so that form is a parse error there (CI runs bash 4+, so
# CI never caught it). This static guard fires on ANY platform.
# (Strip comment lines first so the explanatory comment in the hook, which
# names the anti-pattern, doesn't trip the guard on itself.)
has_antipattern() {  # $1 = file
  grep -Ev '^[[:space:]]*#' "$1" | grep -Eq -- '-c[[:space:]]+"\$\(cat'
}
if has_antipattern "$HOOK_SRC"; then
  fail "log-mutation.sh uses the heredoc-in-\$() anti-pattern (breaks bash 3.2; see #13)"
fi
# Self-test: the guard must actually fire on the bad pattern, not be vacuous.
PLANT="$TMP/plant.sh"; printf 'python3 -c "$(cat << EOF\nEOF\n)"\n' > "$PLANT"
if ! has_antipattern "$PLANT"; then
  fail "anti-pattern guard is vacuous (did not match a planted heredoc-in-\$())"
fi

# --- Functional test under system bash --------------------------------------
# Prefer /bin/bash explicitly (3.2 on macOS — the version that regressed). The
# hook computes REPO_ROOT as ../../ from its own location, so install it under a
# fake vault's .claude/hooks/ and point the payload at a typed note in it.
BASH_BIN="/bin/bash"; [ -x "$BASH_BIN" ] || BASH_BIN="$(command -v bash)"
VAULT="$TMP/vault"
mkdir -p "$VAULT/.claude/hooks" "$VAULT/Ops/Tasks" "$VAULT/Inbox"
cp "$HOOK_SRC" "$VAULT/.claude/hooks/log-mutation.sh"
printf '# Log\n\npreamble\n' > "$VAULT/log.md"
HOOK="$VAULT/.claude/hooks/log-mutation.sh"

run_hook() {  # $1 = file_path; feeds a PostToolUse-shaped payload on stdin
  printf '%s' '{"tool_input":{"file_path":"'"$1"'"}}' | "$BASH_BIN" "$HOOK"
}

# Typed note -> exit 0 and a placeholder prepended (above the preamble's top
# log line, but the count is what matters here).
run_hook "$VAULT/Ops/Tasks/x.md" || fail "hook exited non-zero on a typed note (parse error?)"
[ "$(grep -c 'auto-placeholder' "$VAULT/log.md")" -eq 1 ] || fail "no placeholder appended for typed note"
grep -q '\[\[x\]\]' "$VAULT/log.md" || fail "placeholder missing the [[x]] wikilink"

# Dedupe: an immediate second Edit to the same note must NOT add a 2nd line.
run_hook "$VAULT/Ops/Tasks/x.md" || fail "hook exited non-zero on dedupe path"
[ "$(grep -c 'auto-placeholder' "$VAULT/log.md")" -eq 1 ] || fail "dedupe failed: duplicate placeholder"

# Non-typed locations and the log itself must be skipped (still exit 0).
run_hook "$VAULT/Inbox/note.md" || fail "hook exited non-zero on Inbox skip"
run_hook "$VAULT/log.md"        || fail "hook exited non-zero on log.md skip"
[ "$(grep -c 'auto-placeholder' "$VAULT/log.md")" -eq 1 ] || fail "skipped paths still mutated log.md"

# Empty / file_path-less payloads must be skipped by the prefilter (exit 0).
printf '%s' '{"tool_input":{}}' | "$BASH_BIN" "$HOOK" || fail "hook exited non-zero on payload without file_path"

echo "PASS: log-mutation hook (bash $("$BASH_BIN" --version | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1))"
