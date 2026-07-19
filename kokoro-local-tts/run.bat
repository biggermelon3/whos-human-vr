@echo off
REM Start the Kokoro local TTS server (does not install anything).
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found at .venv
  echo Run the one-time setup first ^(see README.md^).
  exit /b 1
)

echo Starting Kokoro TTS on http://127.0.0.1:8000 (Ctrl+C to stop)...
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
endlocal
