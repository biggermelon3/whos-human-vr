#!/usr/bin/env bash
# Stop the background server + agent runners started by play-file-mode.sh (macOS/Linux).
DIR="$(cd "$(dirname "$0")" && pwd)"
L="$DIR/who-is-human/logs"

if [ -f "$L/server.pid" ]; then
  kill "$(cat "$L/server.pid")" 2>/dev/null && echo "server stopped"
  rm -f "$L/server.pid"
fi
if [ -f "$L/agent-pids.txt" ]; then
  # shellcheck disable=SC2046
  kill $(cat "$L/agent-pids.txt") 2>/dev/null && echo "agents stopped"
  : > "$L/agent-pids.txt"
fi
echo "done."
