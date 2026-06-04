#!/bin/zsh
# Durable Quartz dev-server launcher, designed to be run by a launchd LaunchAgent
# (com.memex.quartz) so the local site at http://localhost:{{QUARTZ_PORT}} stays up
# across sleep/wake and is independent of any terminal or Claude Code session.
#
# launchd gives jobs a minimal PATH with no nvm, so we source nvm here and let it
# pick the default node — this keeps working across node version bumps. Resolves
# the repo root relative to this script so it's not tied to an absolute path.

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../quartz" || exit 1

# exec so launchd tracks the node process directly (clean KeepAlive restarts).
exec npm run site:serve
