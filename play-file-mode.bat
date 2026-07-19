@echo off
rem ============================================================
rem  Who is Human - FILE mode, one double-click (Windows).
rem  Starts the game server + the six local CLI agents (Claude by
rem  default), then tells you to pick "Local agents" in the menu.
rem
rem  Drop your packaged build in a "game\" folder next to this file
rem  and it gets launched automatically too.
rem
rem  Use a different CLI:   play-file-mode.bat codex
rem ============================================================
setlocal
cd /d "%~dp0"

set "CLI=%~1"
if "%CLI%"=="" set "CLI=claude"

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0play-file-mode.ps1" -Cli %CLI%

echo.
echo Server and agents launched in their own windows.
echo This window can be closed.
pause
