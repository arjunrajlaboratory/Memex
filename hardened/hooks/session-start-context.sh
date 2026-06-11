#!/usr/bin/env bash
# SessionStart hook: surfaces minimal vault context so the agent doesn't
# cold-scan log.md / tasks / briefing / Inbox/ at the top of every session.
# stdout becomes additional system context per Claude Code SessionStart semantics.
#
# Deliberately NOT using `set -e` — a hook must never break a session, so each
# step is defensive and best-effort.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
cd "$REPO_ROOT" || exit 0

today="$(date +%Y-%m-%d)"

echo "=== LifeOS vault session-start (hook) ==="
echo

# Recent log.md entries — newest are at the TOP of the file (preamble first).
# Filter to lines that start with an ISO-8601 timestamp.
if [ -f log.md ]; then
  echo "log.md (5 most recent):"
  grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' log.md 2>/dev/null | head -5 | sed 's/^/  /'
  echo
fi

# Open Task counts by status. `grep -l` returns 1 on no-match — swallow that.
task_glob="Ops/Tasks/Task*.md"
if ls $task_glob >/dev/null 2>&1; then
  echo "Open tasks:"
  for s in next in_progress scheduled waiting needs_review; do
    n=$( (grep -l "^status: ${s}$" $task_glob 2>/dev/null || true) | wc -l | tr -d ' ')
    if [ "${n:-0}" != "0" ]; then
      printf "  %-14s %s\n" "$s:" "$n"
    fi
  done
  echo
fi

# Today's briefing
if [ -f "Ops/Briefings/${today}.md" ]; then
  echo "Today's briefing (${today}): exists at Ops/Briefings/${today}.md"
else
  echo "Today's briefing (${today}): MISSING — consider /daily-briefing"
fi

# Inbox/ top-level (excluding README + _filed/)
if [ -d "Inbox" ]; then
  inbox_count="$(find Inbox -maxdepth 1 -type f ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${inbox_count:-0}" != "0" ]; then
    echo "Inbox/: ${inbox_count} item(s) waiting — consider /triage-inbox"
  else
    echo "Inbox/: empty top level (clean)"
  fi
fi

# needs_review tasks — different cut, surfaces agent work awaiting user
if ls $task_glob >/dev/null 2>&1; then
  needs_review_files="$( (grep -l "^status: needs_review$" $task_glob 2>/dev/null || true) )"
  if [ -n "$needs_review_files" ]; then
    echo
    echo "Tasks awaiting your review (needs_review):"
    printf '%s\n' "$needs_review_files" | while read -r f; do
      [ -z "$f" ] && continue
      title="$(awk -F'"' '/^title:/{print $2; exit}' "$f" 2>/dev/null)"
      [ -z "$title" ] && title="$(basename "$f" .md)"
      echo "  - $title"
    done
  fi
fi

# Quartz dev server — start if not running on :{{QUARTZ_PORT}} (used by skills to open
# readable artifacts in the browser; see memory feedback_open_artifacts_in_browser).
if [ -d quartz ] && ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  echo "Quartz: starting dev server on :{{QUARTZ_PORT}} (background)..."
  ( cd quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown ) >/dev/null 2>&1
elif lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  echo "Quartz: dev server already up on http://localhost:{{QUARTZ_PORT}}"
fi

echo
echo "=== end vault session-start ==="
exit 0
