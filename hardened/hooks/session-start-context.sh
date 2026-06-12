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

echo "=== Memex vault session-start (hook) ==="
echo

# Recent log.md entries — newest are at the TOP of the file (preamble first).
# Filter to lines that start with an ISO-8601 timestamp.
if [ -f log.md ]; then
  echo "log.md (5 most recent):"
  grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' log.md 2>/dev/null | head -5 | sed 's/^/  /'
  echo
fi

# Open Task counts by status — one awk pass over all Task files (the old
# version ran grep -l six times over the same glob).
task_glob="Ops/Tasks/Task*.md"
task_scan=""
if ls $task_glob >/dev/null 2>&1; then
  task_scan="$(awk '
    FNR==1 { seen=0 }
    /^status:[[:space:]]*/ && !seen {
      seen=1; s=$2; c[s]++
      if (s == "needs_review") nr[FILENAME]=1
    }
    END {
      for (k in c) printf "count %s %d\n", k, c[k]
      for (f in nr) printf "review %s\n", f
    }
  ' $task_glob 2>/dev/null)"
  echo "Open tasks:"
  for s in next in_progress scheduled waiting needs_review; do
    n="$(printf '%s\n' "$task_scan" | awk -v s="$s" '$1=="count" && $2==s {print $3}')"
    [ -n "${n:-}" ] && printf "  %-14s %s\n" "$s:" "$n"
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

# needs_review tasks — different cut, surfaces agent work awaiting user.
# Task filenames contain spaces, so parse the awk "review <file>" lines with
# cut -d' ' -f2- (NOT awk $2).
needs_review_files="$(printf '%s\n' "${task_scan:-}" | grep '^review ' | cut -d' ' -f2-)"
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

# Quartz dev server — start if not running on :{{QUARTZ_PORT}} (used by skills to open
# readable artifacts in the browser; see memory feedback_open_artifacts_in_browser).
if [ -d quartz ] && ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  echo "Quartz: starting dev server on :{{QUARTZ_PORT}} (background)..."
  mkdir -p outputs
  ( cd quartz && npm run site:serve > "$REPO_ROOT/outputs/quartz-serve.log" 2>&1 & disown ) >/dev/null 2>&1
elif lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  echo "Quartz: dev server already up on http://localhost:{{QUARTZ_PORT}}"
fi

echo
echo "=== end vault session-start ==="
exit 0
