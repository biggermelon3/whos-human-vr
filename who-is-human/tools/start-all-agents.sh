#!/usr/bin/env bash
# start-all-agents.sh — launch a background runner for every agent slot.
# The slot that is the human this game never gets turn files and stays idle.
#
#   ./tools/start-all-agents.sh claude
#   CLI=codex ./tools/start-all-agents.sh
#
# Stop them all with:  kill $(cat logs/agent-pids.txt)
set -u
CLI="${1:-${CLI:-claude}}"
MODEL="${2:-${MODEL:-}}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Default to the repo-root agent-workspace (absolute), the SAME folder the server
# writes to (src/agents/factory.ts anchors there too). Absolute so each nohup'd
# runner watches it no matter what CWD the launcher was invoked from.
WORKSPACE="${WORKSPACE:-$DIR/agent-workspace}"
mkdir -p "$DIR/logs"
: > "$DIR/logs/agent-pids.txt"

for id in A-01 A-02 A-03 A-04 A-05 A-06 A-07; do
  nohup bash "$DIR/tools/agent-runner.sh" "$id" "$CLI" "$WORKSPACE" "$MODEL" \
    > "$DIR/logs/agent-$id.log" 2>&1 &
  echo "$!" >> "$DIR/logs/agent-pids.txt"
  echo "launched $id (cli=$CLI) pid $!"
done
echo "Logs in logs/agent-*.log — stop all with: kill \$(cat logs/agent-pids.txt)"
