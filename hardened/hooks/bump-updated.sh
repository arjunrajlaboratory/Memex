#!/usr/bin/env bash
# PostToolUse hook: auto-bumps `updated:` in YAML frontmatter of vault notes
# after Edit/Write. Idempotent — safe to fire multiple times in a row.
# Reads tool JSON from stdin per Claude Code PostToolUse semantics.
#
# Deliberately NOT using `set -e`/pipefail — a hook must never break a session
# (the no-match grep in the jq-less fallback exits 1, which pipefail turned
# into a hook failure on every non-file tool call).
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0

input="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  file_path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null \
    | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/' || true)"
fi
[ -z "${file_path:-}" ] && exit 0

# Scope: only this vault (an Edit to another repo's Atlas/ must not be touched),
# only typed notes under tracked folders, never schemas/templates/archive/inbox/raw.
case "$file_path" in "$REPO_ROOT"/*) ;; *) exit 0 ;; esac
case "$file_path" in *.md) ;; *) exit 0 ;; esac
case "$file_path" in */_archive/*|*/Inbox/*|*/_schemas/*|*/_templates/*|*/_workflows/*|*/Raw/*) exit 0 ;; esac
case "$file_path" in
  "$REPO_ROOT"/Atlas/*|"$REPO_ROOT"/Ops/Tasks/*|"$REPO_ROOT"/Ops/Followups/*|"$REPO_ROOT"/Ops/Briefings/*|"$REPO_ROOT"/Ops/Reviews/*) ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0
head -40 "$file_path" 2>/dev/null | grep -q '^updated:' || exit 0

today="$(date +%Y-%m-%d)"
tmp="${file_path}.bump-tmp.$$"

awk -v today="$today" '
  BEGIN { in_fm=0; bumped=0 }
  NR==1 && /^---$/ { in_fm=1; print; next }
  in_fm && /^---$/ { in_fm=0; print; next }
  in_fm && /^updated:/ && !bumped { print "updated: " today; bumped=1; next }
  { print }
' "$file_path" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }

# cat-over (not mv): preserves the file's inode and mode. Only swap if
# non-empty and different — preserves the file on an awk hiccup.
if [ -s "$tmp" ] && ! cmp -s "$file_path" "$tmp"; then
  cat "$tmp" > "$file_path"
fi
rm -f "$tmp"
exit 0
