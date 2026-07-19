<#
  play-file-mode.ps1  --  one command to play "Who is Human" in FILE mode on
  Windows (the six AI foxes run on your local Claude / Codex / Gemini CLI, i.e.
  your subscription -- NO API key, NO per-token billing).

  Lives at the repo root and finds the server in .\who-is-human. It:
    1. starts the game server   -> http://127.0.0.1:8787  (own window, shows logs)
    2. starts the six agents    -> one runner window per fox slot
    3. (optional) launches your packaged Windows build if it can find it

  Then pick  Server = Local -> Backend = "Local agents" -> START  in the menu.

  Usage (from anywhere):
      pwsh play-file-mode.ps1
      pwsh play-file-mode.ps1 -Cli codex
      pwsh play-file-mode.ps1 -GameExe "C:\Games\WhosHuman\WhosHuman.exe"

  Stop: close the server window and the seven runner windows.
#>
param(
  [ValidateSet("claude", "codex", "gemini")][string]$Cli = "claude",
  [string]$Model = "",
  [string]$GameExe = ""
)
$ErrorActionPreference = "Stop"
$server = Join-Path $PSScriptRoot "who-is-human"

Write-Host "=== Who is Human -- FILE mode launcher ($Cli) ===" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $server "package.json"))) {
  Write-Host "[X] Can't find the who-is-human server at $server" -ForegroundColor Red
  Write-Host "    Run this from the repo root (it must sit next to the who-is-human folder)." -ForegroundColor DarkGray
  exit 1
}

# 0) Is the coding-agent CLI installed and on PATH?
#    NOTE: use a NON-colliding variable name. PowerShell variables are
#    case-insensitive, so a var named $cli would BE the $Cli parameter, and
#    assigning Get-Command's result (coerced to "claude.exe") would re-trigger
#    the [ValidateSet] on $Cli and throw.
$cliCmd = Get-Command $Cli -ErrorAction SilentlyContinue
if (-not $cliCmd) {
  Write-Host "[X] '$Cli' not found on PATH. Install it and log in first, then re-run." -ForegroundColor Red
  Write-Host "    (file mode drives the foxes with your $Cli subscription -- no API key needed.)" -ForegroundColor DarkGray
  exit 1
}
Write-Host "[ok] $Cli found: $($cliCmd.Source)" -ForegroundColor Green

# 1) Dependencies present? (first run on a dev machine)
if (-not (Test-Path (Join-Path $server "node_modules\tsx"))) {
  Write-Host "[..] installing server dependencies (first run)..." -ForegroundColor Yellow
  Push-Location $server
  try { & npm install } finally { Pop-Location }
}

# 2) Start the game server in its own window (file backend by default).
$env:WIH_AGENT_BACKEND = "file"
Write-Host "[..] starting server -> http://127.0.0.1:8787" -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/k", "title who-is-human server && `"$server\start-server.bat`""

# 3) Give it a moment to bind, then launch the six agent runners.
Start-Sleep -Seconds 3
Write-Host "[..] launching $Cli agent runners..." -ForegroundColor Cyan
& (Join-Path $server "tools\start-all-agents.ps1") -Cli $Cli -Model $Model

# 4) Optionally launch the packaged build. Explicit -GameExe wins; otherwise look
#    for a build dropped in game\ (next to this script, or under who-is-human\).
if (-not $GameExe) {
  foreach ($dir in @((Join-Path $PSScriptRoot "game"), (Join-Path $server "game"))) {
    $guess = Get-ChildItem -Path $dir -Filter *.exe -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -notmatch "UnityCrashHandler" } | Select-Object -First 1
    if ($guess) { $GameExe = $guess.FullName; break }
  }
}
if ($GameExe -and (Test-Path $GameExe)) {
  Write-Host "[..] launching game: $GameExe" -ForegroundColor Cyan
  Start-Process -FilePath $GameExe
}

Write-Host ""
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " Server + six $Cli agents are up." -ForegroundColor Green
Write-Host " In the menu:  Server = Local  ->  Backend = 'Local agents'  ->  START GAME" -ForegroundColor Yellow
Write-Host " Each runner window prints  [A-0X] -> turn-001.json  then  <- ok  as a fox acts." -ForegroundColor DarkGray
Write-Host " Stop everything by closing the server window + the seven runner windows." -ForegroundColor DarkGray
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
