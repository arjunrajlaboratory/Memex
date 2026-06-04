#!/usr/bin/env bash
# PostToolUse hook: auto-bumps `updated:` in YAML frontmatter of vault notes
# after Edit/Write. Idempotent — safe to fire multiple times in a row.
# Reads tool JSON from stdin per Claude Code PostToolUse semantics.
set -euo pipefail

input="$(cat)"

# Extract file_path from tool_input (Edit and Write both use this key).
# jq is standard on macOS; fall back to a regex grep if absent.
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  file_path="$(printf '%s' "$input" | grep -oE '"file_path":[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path":[[:space:]]*"\(.*\)".*/\1/')"
fi
[ -z "${file_path:-}" ] && exit 0

# Only typed notes under tracked vault folders. Never schemas, templates,
# archive, inbox, raw, or anything outside Atlas / Ops.
case "$file_path" in
  *.md) ;;
  *) exit 0 ;;
esac
case "$file_path" in
  */_archive/*|*/Inbox/*|*/_schemas/*|*/_templates/*|*/_workflows/*|*/Raw/*) exit 0 ;;
esac
case "$file_path" in
  */Atlas/*|*/Ops/Tasks/*|*/Ops/Followups/*|*/Ops/Briefings/*|*/Ops/Reviews/*) ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0

# Must have an `updated:` field in the first ~40 lines (i.e., inside frontmatter)
if ! head -40 "$file_path" 2>/dev/null | grep -q '^updated:'; then
  exit 0
fi

today="$(date +%Y-%m-%d)"
tmp="${file_path}.bump-tmp.$$"

# Awk: walk the frontmatter (first --- ... ---), replace the first `updated:`
# line with today's date. Block-scalar values and other multi-line fields
# pass through untouched.
awk -v today="$today" '
  BEGIN { in_fm=0; fm_seen=0; bumped=0 }
  NR==1 && /^---$/ { in_fm=1; fm_seen=1; print; next }
  in_fm && /^---$/ { in_fm=0; print; next }
  in_fm && /^updated:/ && !bumped { print "updated: " today; bumped=1; next }
  { print }
' "$file_path" > "$tmp"

# Only swap if non-empty and different — preserves file on awk hiccup
if [ -s "$tmp" ] && ! cmp -s "$file_path" "$tmp"; then
  mv "$tmp" "$file_path"
else
  rm -f "$tmp"
fi
exit 0
