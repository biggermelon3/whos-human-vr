# Start the Kokoro local TTS server.
# ASCII-only on purpose: Windows PowerShell 5.1 reads no-BOM UTF-8 as CP1252,
# so a stray non-ASCII byte can break parsing. Keep this file ASCII.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Virtual environment not found at .venv" -ForegroundColor Red
    Write-Host "Run the one-time setup first (see README.md), for example:"
    Write-Host "  uv venv --python 3.12 .venv"
    Write-Host "  uv pip install --python .venv\Scripts\python.exe torch --index-url https://download.pytorch.org/whl/cpu"
    Write-Host "  uv pip install --python .venv\Scripts\python.exe -e ."
    exit 1
}

Write-Host "Starting Kokoro TTS on http://127.0.0.1:8000 (Ctrl+C to stop)..."
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
