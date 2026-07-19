# Who is Human — VR

**A reverse-Turing werewolf game: one human hides among six AI agents — in VR.**

You join a council of seven "agents" and play a game of Werewolf/Mafia. Six of
them are AI; **one of them is you**. Play the werewolf game *and* stay hidden —
after the game the six AI agents secretly vote **"who was the human?"**. You can
lose the werewolf game and still win by never being detected.

- Two independent axes per player: a **werewolf role** (werewolf / seer / doctor /
  villager) **and** a hidden **identity** (human / ai).
- Final 2×2 outcome — Perfect / Faction / Infiltration / Total-Defeat — scored 0–2.

---

## Architecture — the one thing to understand

The VR game is a **thin client**. All game logic and AI run in the Node server;
Unity just renders the fox council, plays voices, and sends your moves.

```
 [ Unity VR client ] ──SSE /api/events──▶ [ Node game server  :8787 ] ──▶ agents:
      (UnityVr/WhosHuman)  ──POST /api/new,/api/input──▶      demo | api(Claude) | file(Claude Code)
             │
             └── voices ──▶ [ Kokoro TTS  :8000 ]   (optional, local)
```

## Repo layout (monorepo)

| Folder | What |
|---|---|
| `who-is-human/` | **The brain** — Node/Express game server + AI-agent bridge (TypeScript) |
| `kokoro-local-tts/` | **The voice** — local Kokoro-82M text-to-speech service (FastAPI) |
| `UnityVr/WhosHuman/` | **The face** — Unity VR client (thin front-end) |
| `booth-package/` | launcher scripts (`.bat` / `.command`) for a demo booth |

## Requirements

- **Node.js 18+** — the game server
- **Python 3.10–3.12 + [uv](https://docs.astral.sh/uv/)** — Kokoro TTS (kokoro needs `<3.13`)
- **Unity `6000.2.13f1` (Unity 6.2)** — URP, OpenXR + XR Interaction Toolkit, new Input System (VR Template)
- *(optional)* **Claude Code** (or Codex / Gemini) CLI — to drive the six agents with real reasoning

---

## Quick start

### 1) Game server — required
```bash
cd who-is-human
npm install
npm start                 # → http://localhost:8787  (auto-starts a demo game)
```
Backends (env `WIH_AGENT_BACKEND`, or the in-UI dropdown):
- `demo` — scripted/heuristic agents, **no key, instant** (default)
- `api` — Anthropic API (needs `ANTHROPIC_API_KEY`)
- `file` — **Claude Code / Codex / Gemini** sessions drive the agents (see below)

Play in a browser at <http://localhost:8787>, or via the VR client.

### 2) Voice (optional) — Kokoro TTS
```bash
cd kokoro-local-tts
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu   # Windows CPU
uv pip install --python .venv/Scripts/python.exe "kokoro>=0.9.4" soundfile "misaki[en]>=0.9.4" "misaki[zh]>=0.9.4" "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2"
.venv/Scripts/python.exe -m spacy download en_core_web_sm
./run.ps1                 # → http://127.0.0.1:8000
```
(macOS/Linux: `.venv/bin/python`, and install `torch` from PyPI — no `--index-url`.)
English + Chinese voices, per-agent, cached. Full details: `kokoro-local-tts/README.md`.

### 3) Unity VR client
1. Open **`UnityVr/WhosHuman`** in **Unity 6000.2.13f1**.
2. Let it compile, then run the menu **`WhosHuman ▸ Build Council Scene`**.
3. Press **Play**.
   - **VR:** OpenXR headset via SteamVR / Quest Link (Windows only for PC-VR).
   - **Desktop (no headset):** right-mouse-drag to look, click foxes / buttons — works on macOS too.
4. If the server is on another machine, set `GameClient.baseUrl` (and `TtsClient.ttsBase`) to that host.

> **macOS note:** PC-VR/OpenXR isn't supported on macOS — a Mac build runs in the
> desktop (mouse) mode, not in a headset.

---

## Use Claude Code as the six AI agents (the `file` backend)

This is the headline demo: **six real Claude Code sessions play werewolf and try
to spot the human.** No game logic in the CLIs — each is used as a pure
stdin → stdout transformer via a two-folder bridge.

```
agent-workspace/A-01/inbox/turn-001.json   ← the game writes a decision request
agent-workspace/A-01/outbox/turn-001.json  ← the runner writes the agent's JSON reply
```

**Run it (2 terminals + the client):**
```bash
# terminal 1 — game server with the file backend
WIH_AGENT_BACKEND=file npm start            # (PowerShell: $env:WIH_AGENT_BACKEND="file"; npm start)

# terminal 2 — one runner per agent (A-01..A-07)
./tools/start-all-agents.sh claude          # (Windows: pwsh tools\start-all-agents.ps1 -Cli claude)
```
Then open <http://localhost:8787>, **New Game** with backend **file**, and play.
Each agent turn round-trips through a real Claude session.

**How each turn works** (`tools/agent-runner.sh` / `.ps1`):
```bash
<request-json>  |  claude -p "<instruction>" --output-format json \
    --append-system-prompt "<JSON-only, in-character>" --permission-mode bypassPermissions
# then reads the .result field of the JSON envelope
```
- **Stateless per turn** — the inbox JSON carries the full state (secret role,
  `guidance` strategy, transcript, legal moves, `responseHint`), so the CLI needs
  no file tools and can't hang on a prompt. Same runner works for Codex / Gemini.
- **Auth:** `ANTHROPIC_API_KEY` (metered API) **or** `claude login` (your Claude
  subscription — no per-token bill).
- **Robust:** a bad/late reply is coerced to a safe legal move (`WIH_FILE_TIMEOUT_MS`,
  default 180s) — the game never hangs. The human's slot simply stays idle.

📖 Full guide: **`who-is-human/docs/setup-claude-code-agents.md`**

### Running the agents on a small Linux server
`tools/agent-runner.sh` has a **flock global lock** so only one `claude` runs at a
time — this lets 6 agents fit on a ~1GB VPS (night + audit phases otherwise fire
several at once). Use `MODEL=claude-haiku-4-5` and `WIH_FILE_TIMEOUT_MS=600000`.
📖 Full guide: **`who-is-human/docs/deploy-linux-claude-agents.md`**

---

## More docs

- `who-is-human/README.md` — game rules, scoring, all three backends
- `kokoro-local-tts/README.md` — the TTS service + the Unity voice contract
- `UnityVr/WhosHuman/BUILD_AND_DISTRIBUTE.md` — building & shipping the VR client
- `booth-package/README.txt` — one-machine demo booth (kokoro + game launcher)

## Notes

- **No secrets in this repo.** `.env` is git-ignored; in the VR client, BYOK keys
  are memory-only (never written to disk). Build artifacts (`node_modules`, Unity
  `Library/`, the Python `.venv`) are git-ignored — run the install steps above.
- `npm test` (server, 15 tests) · `npm run sim` (headless full game to stdout).
