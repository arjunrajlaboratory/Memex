#!/usr/bin/env bash
# PostToolUse hook: auto-append a placeholder log line for any Edit/Write to a
# typed vault note. The vault's discipline ("every mutation logged") is
# systematically dropped by skill-driven sessions — the 2026-05-24 audit found
# 5+ sessions doing 10-60 vault edits with zero log.md touches. This hook
# guarantees something gets recorded; the agent rewrites the placeholder with a
# real summary at workflow end.
#
# Deliberately NOT using `set -e` — a hook must never break a session.
#
# Hook input arrives as JSON on stdin per Claude Code PostToolUse spec.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
cd "$REPO_ROOT" || exit 0

# Read hook input (best-effort — fall back to env if stdin is empty)
hook_input="$(cat 2>/dev/null || true)"
file_path="$(printf '%s' "$hook_input" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    p = d.get('tool_input', {}).get('file_path', '') or ''
    print(p)
except Exception:
    pass
" 2>/dev/null)"

[ -z "$file_path" ] && exit 0

# Never log a write to log.md itself (would infinite-loop)
[[ "$file_path" == */log.md ]] && exit 0

# Only handle paths inside this vault
[[ "$file_path" != "$REPO_ROOT"/* ]] && exit 0
rel_path="${file_path#$REPO_ROOT/}"

# Filter: only typed vault notes (mirror bump-updated.sh's path filter)
case "$rel_path" in
  Atlas/*/*.md|Ops/Tasks/*.md|Ops/Followups/*.md|Ops/Briefings/*.md|Ops/Reviews/*.md) ;;
  *) exit 0 ;;
esac

# Skip archive / inbox / schemas / templates / workflows
case "$rel_path" in
  *_archive*|*Inbox/*|*_schemas*|*_templates*|*_workflows*) exit 0 ;;
esac

basename="$(basename "$rel_path" .md)"
ts="$(date +%Y-%m-%dT%H:%M:%S%z | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')"

# Dedupe: skip if a placeholder for this basename was added in the last 60s.
# Without dedupe, 10 consecutive Edits to the same Task produce 10 placeholders.
if [ -f log.md ]; then
  recent_line="$(grep -F "[[$basename]]" log.md 2>/dev/null | head -1)"
  if [ -n "$recent_line" ]; then
    ts_recent="$(printf '%s' "$recent_line" | awk '{print $1}')"
    if [ -n "$ts_recent" ]; then
      now_epoch="$(date +%s)"
      # macOS date format: handle the ISO-8601 with colon in TZ
      ts_clean="$(printf '%s' "$ts_recent" | sed 's/://3')"
      recent_epoch="$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$ts_clean" +%s 2>/dev/null || echo 0)"
      if [ "$recent_epoch" -gt 0 ]; then
        diff=$((now_epoch - recent_epoch))
        [ "$diff" -ge 0 ] && [ "$diff" -lt 60 ] && exit 0
      fi
    fi
  fi
fi

new_line="${ts} — agent:auto — touch — [[${basename}]] — auto-placeholder via PostToolUse hook (Edit/Write); rewrite at end-of-workflow with real summary."

# Insert after the preamble, before the first dated entry (or append).
python3 - "$new_line" << 'PYEOF'
import sys
new = sys.argv[1]
path = 'log.md'
try:
    with open(path, 'r') as f:
        lines = f.readlines()
except FileNotFoundError:
    sys.exit(0)
inserted = False
for i, line in enumerate(lines):
    if line.startswith('20') and 'T' in line[:11] and '—' in line:
        lines.insert(i, new + '\n')
        inserted = True
        break
if not inserted:
    if lines and not lines[-1].endswith('\n'):
        lines[-1] += '\n'
    lines.append(new + '\n')
with open(path, 'w') as f:
    f.writelines(lines)
PYEOF

exit 0
