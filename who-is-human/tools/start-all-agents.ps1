<#
  start-all-agents.ps1 - launch a runner window for every agent slot.

  We don't know which slot is the human this game (it's random), so we start all
  seven. The runner bound to the human's slot simply never receives turn files
  and stays idle -- harmless. The human plays in the browser.

  Usage:
      pwsh tools\start-all-agents.ps1 -Cli claude
      pwsh tools\start-all-agents.ps1 -Cli codex -Model gpt-5.5-codex
#>
param(
  [ValidateSet("claude", "codex", "gemini")][string]$Cli = "claude",
  [string]$Model = "",
  [string]$Workspace = "agent-workspace"
)
$ids = "A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07"
$runner = Join-Path $PSScriptRoot "agent-runner.ps1"
foreach ($id in $ids) {
  $argList = @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $runner, "-Agent", $id, "-Cli", $Cli, "-Workspace", $Workspace)
  if ($Model) { $argList += @("-Model", $Model) }
  Start-Process -FilePath "powershell" -ArgumentList $argList
}
Write-Host "Launched 7 agent runners (cli=$Cli). Start a game with backend=file to feed them." -ForegroundColor Cyan
