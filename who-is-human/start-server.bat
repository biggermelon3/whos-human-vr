@echo off
rem ============================================================
rem  Who is Human - server launcher
rem  Used both for local dev (double-click) and for a distributed
rem  build (Unity's ServerBootstrap runs this, or the player does).
rem  Prefers a bundled portable Node (.\node\node.exe) if present,
rem  otherwise falls back to a system-installed `node` on PATH.
rem ============================================================
setlocal
cd /d "%~dp0"

set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"

rem Optional: uncomment to force a backend / port without editing .env
rem set WIH_AGENT_BACKEND=demo
rem set PORT=8787

echo [who-is-human] starting server on http://127.0.0.1:8787  (Ctrl+C to stop)
"%NODE%" "%~dp0node_modules\tsx\dist\cli.mjs" "%~dp0src\server\server.ts"
