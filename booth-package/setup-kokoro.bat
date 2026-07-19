@echo off
rem ================================================================
rem  Who is Human (booth) - one-time kokoro TTS setup
rem  Run this ONCE on the booth PC (needs internet, a few minutes).
rem  Provisions Python 3.12 + torch(CPU) + kokoro + the voice model.
rem ================================================================
setlocal
cd /d "%~dp0kokoro"

where uv >nul 2>nul
if errorlevel 1 (
  echo(
  echo [setup] 'uv' was not found on this PC.
  echo [setup] Install it once, then re-run this file in a NEW terminal:
  echo(
  echo     powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 ^| iex"
  echo(
  pause
  exit /b 1
)

echo [setup] 1/4 creating Python 3.12 venv...
uv venv --python 3.12 .venv || goto :err

echo [setup] 2/4 installing torch (CPU wheel)...
uv pip install --python .venv\Scripts\python.exe torch --index-url https://download.pytorch.org/whl/cpu || goto :err

echo [setup] 3/4 installing kokoro + deps + spaCy model...
uv pip install --python .venv\Scripts\python.exe "kokoro>=0.9.4" soundfile "misaki[en]>=0.9.4" "misaki[zh]>=0.9.4" "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2" || goto :err
.venv\Scripts\python.exe -m spacy download en_core_web_sm || goto :err

echo [setup] 4/4 pre-downloading the Kokoro model (warm-up, ~330MB)...
.venv\Scripts\python.exe scripts\generate_sample.py --text "Hello, Agent." --voice af_heart --language en-US --out _warmup.wav
if exist _warmup.wav del _warmup.wav

echo(
echo [setup] DONE. kokoro is ready. Use start.bat to run the game.
pause
exit /b 0

:err
echo(
echo [setup] FAILED - see the messages above (check the internet connection).
pause
exit /b 1
