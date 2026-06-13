#!/usr/bin/env bash
# PostToolUse hook: auto-append a placeholder log line for any Edit/Write to a
# typed vault note. The vault's discipline ("every mutation logged") is
# systematically dropped by skill-driven sessions — this hook guarantees
# something gets recorded; the agent rewrites the placeholder with a real
# summary at workflow end.
#
# Deliberately NOT using `set -e` — a hook must never break a session.
# Hook input arrives as JSON on stdin per Claude Code PostToolUse spec.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
cd "$REPO_ROOT" || exit 0

hook_input="$(cat 2>/dev/null || true)"
# Cheap prefilter before paying python3 startup: must mention a file_path at all.
case "$hook_input" in *'"file_path"'*) ;; *) exit 0 ;; esac

# NB: payload delivered via env var (HOOK_INPUT), not stdin — that frees stdin
# so the program can be fed through a plain heredoc to `python3 -`. Avoid the
# `python3 -c "$(cat << heredoc)"` form (a heredoc nested in $(…)): macOS's
# system bash 3.2 doesn't skip heredoc bodies when scanning for the closing `)`,
# so the Python source's quotes parse as shell and abort with a syntax error.
# See issue #13.
HOOK_INPUT="$hook_input" python3 - "$REPO_ROOT" <<'PYEOF'
import datetime, json, os, sys, tempfile

try:
    import fcntl
except ImportError:  # non-POSIX: degrade to unlocked (still atomic via os.replace)
    fcntl = None

root = sys.argv[1]
try:
    payload = json.loads(os.environ.get("HOOK_INPUT", "") or "{}")
except Exception:
    sys.exit(0)
file_path = (payload.get("tool_input") or {}).get("file_path") or ""
if not file_path or file_path.endswith("/log.md"):
    sys.exit(0)
prefix = root.rstrip("/") + "/"
if not file_path.startswith(prefix):       # only this vault's files
    sys.exit(0)
rel = file_path[len(prefix):]
parts = rel.split("/")
typed = rel.endswith(".md") and (
    (parts[0] == "Atlas" and len(parts) >= 3)
    or (parts[0] == "Ops" and len(parts) >= 3
        and parts[1] in {"Tasks", "Followups", "Briefings", "Reviews"})
)
if not typed or any(seg in rel for seg in ("_archive", "Inbox/", "_schemas", "_templates", "_workflows")):
    sys.exit(0)

base = os.path.basename(rel)[:-3]
now = datetime.datetime.now().astimezone()
log_path = os.path.join(root, "log.md")
lock_dir = os.path.join(root, ".memex")
os.makedirs(lock_dir, exist_ok=True)
lock = open(os.path.join(lock_dir, "log.lock"), "w")
if fcntl is not None:
    fcntl.flock(lock, fcntl.LOCK_EX)   # released on process exit
try:
    with open(log_path) as f:
        lines = f.readlines()
except FileNotFoundError:
    sys.exit(0)

# Dedupe: skip if the most recent line for this note is < 60s old (10
# consecutive Edits to one Task must not produce 10 placeholders).
needle = f"[[{base}]]"
for line in lines:
    if needle in line:
        try:
            prev = datetime.datetime.fromisoformat(line.split(" ")[0])
            if 0 <= (now - prev).total_seconds() < 60:
                sys.exit(0)
        except (ValueError, TypeError):
            pass
        break

new = (f"{now.isoformat(timespec='seconds')} — agent:auto — touch — [[{base}]] — "
       "auto-placeholder via PostToolUse hook (Edit/Write); rewrite at end-of-workflow with real summary.\n")
insert_at = len(lines)
for i, line in enumerate(lines):   # newest entries live at the top, after the preamble
    if line.startswith("20") and "T" in line[:11] and "—" in line:
        insert_at = i
        break
if insert_at == len(lines) and lines and not lines[-1].endswith("\n"):
    lines[-1] += "\n"
lines.insert(insert_at, new)

fd, tmp = tempfile.mkstemp(dir=root, prefix=".log.md.")
try:
    with os.fdopen(fd, "w") as f:
        f.writelines(lines)
    os.replace(tmp, log_path)      # atomic: a crash can never truncate the log
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
PYEOF

exit 0
