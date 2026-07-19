#!/usr/bin/env bash
# ============================================================
#  play-file-mode.sh -- one command to play "Who is Human" in FILE mode on
#  macOS / Linux. The six AI foxes run on your local Claude / Codex / Gemini
#  CLI (your subscription -- NO API key, NO per-token billing).
#
#  Lives at the repo root and finds the server in ./who-is-human. It:
#    1. starts the game server -> http://127.0.0.1:8787  (background, logged)
#    2. starts the six agents  -> one runner per fox slot  (background, logged)
#    3. (optional) opens your packaged macOS build if it can find one
#
#  Then pick  Server = Local -> Backend = "Local agents" -> START  in the menu.
#
#  Usage:
#    ./play-file-mode.sh                 # claude
#    ./play-file-mode.sh codex           # or codex / gemini
#    GAME_APP=/path/WhosHuman.app ./play-file-mode.sh
#
#  Stop everything:  ./stop-file-mode.command
# ============================================================
set -u
CLI="${1:-claude}"
MODEL="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$SCRIPT_DIR/who-is-human"

echo "=== Who is Human -- FILE mode launcher ($CLI) ==="

if [ ! -f "$SERVER/package.json" ]; then
  echo "[X] Can't find the who-is-human server at $SERVER"
  echo "    Run this from the repo root (next to the who-is-human folder)."
  exit 1
fi

# 0) coding-agent CLI installed?
if ! command -v "$CLI" >/dev/null 2>&1; then
  echo "[X] '$CLI' not found on PATH. Install it and log in first, then re-run."
  echo "    (file mode drives the foxes with your $CLI subscription -- no API key needed.)"
  exit 1
fi
echo "[ok] $CLI found: $(command -v "$CLI")"

cd "$SERVER"

# 1) deps present? (first run)
if [ ! -d node_modules/tsx ]; then
  echo "[..] installing server dependencies (first run)..."
  npm install
fi

# 2) start the server in the background (file backend), log + pid on disk.
mkdir -p logs
echo "[..] starting server -> http://127.0.0.1:8787   (log: who-is-human/logs/server.log)"
WIH_AGENT_BACKEND=file nohup npm start > logs/server.log 2>&1 &
echo "$!" > logs/server.pid

# 3) give it a moment to bind, then launch the six agents (they background too).
sleep 3
echo "[..] launching $CLI agent runners..."
CLI="$CLI" MODEL="$MODEL" ./tools/start-all-agents.sh "$CLI" "$MODEL"

# 4) optionally open the packaged macOS build. GAME_APP wins; else look in game/.
APP="${GAME_APP:-}"
if [ -z "$APP" ]; then
  APP="$(ls -d "$SCRIPT_DIR"/game/*.app "$SERVER"/game/*.app 2>/dev/null | head -1 || true)"
fi
if [ -n "$APP" ] && [ -e "$APP" ] && command -v open >/dev/null 2>&1; then
  echo "[..] opening $APP"
  open "$APP"
fi

echo ""
echo "------------------------------------------------------------"
echo " Server + six $CLI agents are up (running in the background)."
echo " In the menu:  Server = Local  ->  Backend = 'Local agents'  ->  START"
echo " Logs: who-is-human/logs/server.log  and  who-is-human/logs/agent-*.log"
echo " Stop everything:  ./stop-file-mode.command"
echo "------------------------------------------------------------"
