@echo off
rem ================================================================
rem  Who is Human (booth) - launcher
rem  Starts the local kokoro TTS, waits for it, launches the game,
rem  and stops kokoro when the game closes.
rem  The GAME SERVER is remote (your Vultr) - the game's baseUrl must
rem  point at it; there is nothing to launch for that here.
rem ================================================================
setlocal
cd /d "%~dp0"

set "KOKORO=%~dp0kokoro"
set "PY=%KOKORO%\.venv\Scripts\python.exe"
set "GAME=%~dp0game\WhosHuman.exe"

if not exist "%PY%" (
  echo [start] kokoro is not set up yet.
  echo [start] Run  setup-kokoro.bat  first ^(one time, needs internet^).
  pause
  exit /b 1
)
if not exist "%GAME%" (
  echo [start] game\WhosHuman.exe not found - put the Unity build in the 'game' folder.
  pause
  exit /b 1
)

echo [start] launching kokoro TTS on http://127.0.0.1:8000 ...
pushd "%KOKORO%"
start "kokoro-tts" /min "%PY%" -m uvicorn app.main:app --app-dir "%KOKORO%" --host 127.0.0.1 --port 8000
popd

echo [start] waiting for kokoro to be ready...
set /a _tries=0
:waitloop
set /a _tries+=1
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto :ready
if %_tries% GEQ 40 goto :timeout
timeout /t 2 /nobreak >nul
goto :waitloop

:timeout
echo [start] kokoro slow to start - launching the game anyway (voices kick in once ready).

:ready
echo [start] launching the game...
start "" /wait "%GAME%"

echo [start] game closed - stopping kokoro...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*app.main*8000*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /FI "WINDOWTITLE eq kokoro-tts*" /T /F >nul 2>&1
endlocal
exit /b 0
