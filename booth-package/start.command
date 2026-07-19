#!/usr/bin/env bash
# ================================================================
#  Who is Human (booth) - launcher for macOS (desktop / non-VR)
#  Starts local kokoro TTS, waits for it, launches the game .app,
#  stops kokoro when the game quits.
#  The GAME SERVER is remote (your Vultr) - baseUrl points at it.
#  Double-click, or:  chmod +x start.command && ./start.command
# ================================================================
cd "$(dirname "$0")"
KOKORO="$PWD/kokoro"
PY="$KOKORO/.venv/bin/python"
APP="$PWD/game/WhosHuman.app"

if [ ! -x "$PY" ]; then
  echo "[start] kokoro not set up yet - run setup-kokoro.command first (one time, needs internet)."
  exit 1
fi
if [ ! -d "$APP" ]; then
  echo "[start] game/WhosHuman.app not found - put the Mac build in the 'game' folder."
  exit 1
fi

echo "[start] launching kokoro TTS on http://127.0.0.1:8000 ..."
"$PY" -m uvicorn app.main:app --app-dir "$KOKORO" --host 127.0.0.1 --port 8000 >/tmp/kokoro-booth.log 2>&1 &
KPID=$!

echo "[start] waiting for kokoro to be ready..."
for i in $(seq 1 40); do
  if curl -s -o /dev/null http://127.0.0.1:8000/api/health; then break; fi
  sleep 2
done

echo "[start] launching the game..."
open -W "$APP"

echo "[start] game closed - stopping kokoro..."
kill "$KPID" 2>/dev/null || true
