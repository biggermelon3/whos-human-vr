# Connecting the 6 AI agents to Claude Code / Codex / Gemini

This is the "file bridge" backend (`WIH_AGENT_BACKEND=file`). Each of the six AI
agents is driven by a **separate coding-agent session** (Claude Code, Codex CLI,
Gemini CLI, …). The demo of your idea becomes literal: *six real coding agents
play werewolf and try to spot the human, who plays in the browser.*

## The one idea that makes this simple

The game and the coding agent talk **through two folders**:

```
agent-workspace/
  A-01/
    inbox/   turn-001.json   ← the game writes a decision request here
    outbox/  turn-001.json   ← your runner writes the agent's JSON reply here
  A-02/ …
  … A-07/
```

A tiny **runner script** (`tools/agent-runner.*`) watches an `inbox`, pipes the
request into a coding-agent CLI **as plain stdin**, and writes the CLI's JSON
answer to `outbox`. The CLI is used as a pure **stdin → stdout transformer**, so:

- it needs **no file tools** and **no permission grants** — nothing can hang on
  an approval prompt;
- the exact same runner works for Claude Code, Codex, or Gemini — only the CLI
  command differs.

The `inbox/turn-NNN.json` file *is* the full decision request: it contains the
agent's secret role, its public cover profile, the living players, the recent
transcript, the legal moves, and a `responseHint` describing the JSON to return.
It is self-describing — the agent just reads it and answers.

> The game randomizes which of the 7 slots is the **human** each match. Start
> runners for all 7 ids; the one that lands on the human simply never receives
> turn files and stays idle. The human plays in the browser.

---

## Quick start (2 terminals + the browser)

```powershell
# 1) start the game with the file backend
$env:WIH_AGENT_BACKEND = "file"
npm start
```

```powershell
# 2) launch a runner window for each agent (in a second terminal)
pwsh tools\start-all-agents.ps1 -Cli claude
```

Open <http://localhost:8787>, click **New game** with backend **file**, and play.
Each agent turn now round-trips through a real Claude Code session.

Bash / WSL / macOS equivalent:

```bash
WIH_AGENT_BACKEND=file npm start          # terminal 1
./tools/start-all-agents.sh claude        # terminal 2
```

---

## Per-CLI setup

The runner already contains the exact commands; you only need the CLI installed
and authenticated. **Model names and flags drift — verify with `<cli> --help`.**

### A) Claude Code  (`-Cli claude`)

Install: `npm i -g @anthropic-ai/claude-code` (or the platform installer).

Auth — set an API key so unattended runs never wait on a browser login:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # from console.anthropic.com
```

The runner calls, per turn:

```bash
<request-json>  |  claude -p "<instruction>" \
    --output-format json \
    --append-system-prompt "<JSON-only system prompt>" \
    --permission-mode bypassPermissions
# then reads the .result field of the JSON envelope
```

- `-p / --print` → headless, exits after one answer.
- `--output-format json` → returns an envelope; the reply text is in `.result`
  (also carries `usage` for cost tracking).
- `--append-system-prompt` → locks the model to "JSON only, in character".
- `--permission-mode bypassPermissions` → never prompts. Because we pipe the
  file in and take stdout, the session touches no tools anyway; this just
  guarantees no interactive stall. (Some builds also accept a stricter
  `--allowedTools "Read,Write"` + settings.json allowlist — not needed here.)
- Optional model: `-Model claude-sonnet-5` (cheaper while iterating) — Opus is
  strongest, Sonnet/Haiku are cheaper.

Cost: roughly a fraction of a cent per turn (≈1–2k input, ≈300 output tokens);
a full game is a few dozen turns per agent.

### B) OpenAI Codex CLI  (`-Cli codex`)

Install: `npm i -g @openai/codex` (or the official installer).

Auth (pick one):

```powershell
$env:OPENAI_API_KEY = "sk-..."            # unattended / CI
# or interactive: codex login             # ChatGPT sign-in
```

The runner calls:

```bash
"<instruction>\n\n<request-json>"  |  codex exec \
    --skip-git-repo-check -s read-only -a never  -
# codex prints progress to stderr and ONLY the final message to stdout
```

- `codex exec` → non-interactive; final message → stdout (exactly what we want).
- `--skip-git-repo-check` → required, since `agent-workspace/` isn't a git repo.
- `-s read-only` → sandbox with no writes (we don't need any).
- `-a never` → never ask for approval (no hangs).
- `-` → read the prompt from stdin.
- Optional hardening: add `--output-schema tools/decision.schema.json` for
  server-enforced JSON (schema varies per decision kind, so the prompt +
  fence-stripping in the runner is the portable default).
- Model: `-Model gpt-5.x-codex` (confirm the current id with `codex --help`).

### C) Gemini CLI  (`-Cli gemini`)

Install: `npm i -g @google/gemini-cli`.

Auth: run `gemini` once and pick **Sign in with Google** (free tier ≈1,000
requests/day), or `export GEMINI_API_KEY=...` from AI Studio.

The runner calls:

```bash
<request-json>  |  gemini -p "<instruction>" --yolo
# stdout is the raw model text (default text mode — do NOT use --output-format json,
# which double-encodes the reply inside a .response string)
```

- `-p` → headless/one-shot; `--yolo` → auto-approve so nothing blocks.
- Model: `-Model gemini-3-flash` (verify the current id; Flash is cheap/fast).

### Mixing CLIs

You can point different agents at different CLIs for a fun asymmetric game — e.g.
three Claude, two Codex, one Gemini:

```powershell
pwsh tools\agent-runner.ps1 -Agent A-01 -Cli claude
pwsh tools\agent-runner.ps1 -Agent A-02 -Cli codex
pwsh tools\agent-runner.ps1 -Agent A-03 -Cli gemini
# … one window per agent
```

---

## Test one turn by hand (no game needed)

```powershell
# fake a request, then run the CLI the way the runner does
'{ "responseHint": "{ \"lynchVote\": one living player or \"abstain\" }", "options": { "legalTargets": ["A-01","A-03"] } }' `
  | claude -p "Reply with ONLY the JSON described by responseHint." --output-format json `
  | ConvertFrom-Json | Select-Object -ExpandProperty result
```

You should get back something like `{ "lynchVote": "A-03" }`.

---

## Design notes & gotchas

- **Stateless per turn (intentional).** Each `inbox` request carries the full
  game state (roles you know, transcript, legal moves), so the runner does **not**
  use `--continue` / `--resume`. This is cheaper, crash-safe, and identical
  across CLIs. If you *want* per-agent memory, have the runner keep a session id
  and resume it — but you'll pay context-rebuild cost for little gain here.
- **Model names & flags change monthly.** Everything above was current for
  mid-2026; always confirm with `claude --help` / `codex --help` / `gemini --help`
  before a demo.
- **Rate limits.** Six concurrent sessions on one machine are fine. Limits are
  per workspace/org, not per process. Watch spend (Claude: `.usage` in the JSON
  envelope; Codex: the rate card).
- **If a CLI mis-answers**, the runner writes `{}` and the game's moderator
  coerces it to a legal fallback move — the game never hangs. If a runner is
  down entirely, the game waits `WIH_FILE_TIMEOUT_MS` (default 180s) then falls
  back too.
- **The human's slot stays idle** — that's expected; you don't need to know
  which id is the human.

---

## Alternative: MCP instead of files

You could expose the game as an MCP server and have each Claude Code connect as
a client (push instead of poll). It's snappier but needs an MCP server plus
per-agent MCP config. The file bridge is the recommended starting point:
zero infrastructure, works offline, trivially debuggable (just read the JSON
files), and CLI-agnostic.
