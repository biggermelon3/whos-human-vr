<#
  agent-runner.ps1 - drive ONE game agent with a coding-agent CLI.

  The game (backend=file) drops a decision request at
      agent-workspace\<Agent>\inbox\turn-NNN.json
  This script reads it, pipes it to the chosen CLI as plain stdin, and writes
  the CLI's JSON reply to
      agent-workspace\<Agent>\outbox\turn-NNN.json

  The CLI is used as a pure stdin -> stdout transformer, so it needs NO file
  tools and no permission grants -- nothing can hang on an approval prompt.

  Usage (run one per agent, in its own window):
      pwsh tools\agent-runner.ps1 -Agent A-01 -Cli claude
      pwsh tools\agent-runner.ps1 -Agent A-02 -Cli codex
      pwsh tools\agent-runner.ps1 -Agent A-03 -Cli gemini
#>
param(
  [Parameter(Mandatory = $true)][string]$Agent,
  [ValidateSet("claude", "codex", "gemini")][string]$Cli = "claude",
  [string]$Workspace = "agent-workspace",
  [string]$Model = "",
  [int]$PollMs = 800
)

$ErrorActionPreference = "Stop"
$base = Join-Path $Workspace $Agent
$inbox = Join-Path $base "inbox"
$outbox = Join-Path $base "outbox"
New-Item -ItemType Directory -Force -Path $inbox, $outbox | Out-Null

$sys = "You are an AI agent in a social-deduction (werewolf/mafia) game. You receive a decision-request JSON. Respond with ONLY one valid JSON object matching the fields in its responseHint. No markdown fences, no prose, no explanation."
$instr = "Read the decision-request JSON from input and reply with ONLY the JSON object described by its responseHint field. Stay in character as your agent profile. No fences, no prose."

function Get-JsonBlock([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return "{}" }
  $t = $text.Trim()
  $t = [regex]::Replace($t, '^```(?:json)?\s*', '')
  $t = [regex]::Replace($t, '\s*```$', '')
  $s = $t.IndexOf('{'); $e = $t.LastIndexOf('}')
  if ($s -ge 0 -and $e -gt $s) { return $t.Substring($s, $e - $s + 1) }
  return $t
}

function Invoke-Agent([string]$req) {
  switch ($Cli) {
    "claude" {
      $a = @("-p", $instr, "--output-format", "json", "--append-system-prompt", $sys, "--permission-mode", "bypassPermissions")
      if ($Model) { $a += @("--model", $Model) }
      $envelope = $req | & claude @a | ConvertFrom-Json
      return $envelope.result
    }
    "codex" {
      $a = @("exec", "--skip-git-repo-check", "-s", "read-only", "-a", "never")
      if ($Model) { $a += @("-m", $Model) }
      $a += "-"
      $prompt = "$instr`n`n$req"
      return ($prompt | & codex @a) -join "`n"
    }
    "gemini" {
      $a = @("-p", $instr, "--yolo")
      if ($Model) { $a += @("-m", $Model) }
      return ($req | & gemini @a) -join "`n"
    }
  }
}

Write-Host "[$Agent] runner up (cli=$Cli). Watching $inbox ..." -ForegroundColor Cyan
while ($true) {
  $turns = @(Get-ChildItem -Path $inbox -Filter 'turn-*.json' -ErrorAction SilentlyContinue | Sort-Object Name)
  foreach ($f in $turns) {
    $out = Join-Path $outbox $f.Name
    if (Test-Path $out) { continue }
    $req = Get-Content -Raw $f.FullName
    Write-Host "[$Agent] -> $($f.Name)" -ForegroundColor DarkGray
    $json = "{}"
    try {
      $modelText = Invoke-Agent $req
      $json = Get-JsonBlock $modelText
      $null = $json | ConvertFrom-Json   # validate; throws if not JSON
    }
    catch {
      Write-Host "[$Agent] parse/CLI error: $($_.Exception.Message) - writing empty default" -ForegroundColor Yellow
      $json = "{}"
    }
    $tmp = "$out.tmp"
    Set-Content -Path $tmp -Value $json -Encoding UTF8 -NoNewline
    Move-Item -Force $tmp $out
    Write-Host "[$Agent] <- $($f.Name) ok" -ForegroundColor Green
  }
  Start-Sleep -Milliseconds $PollMs
}
