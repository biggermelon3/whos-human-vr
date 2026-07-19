# Who is Human 🕵️

A reverse-Turing werewolf game. You are **one human hiding among six AI agents**.
Play standard Werewolf/Mafia — but when the game ends, the six agents secretly
vote on **who was the human**. You can lose the werewolf game and still win the
match by staying hidden.

> First test build of the idea from `WhoisHuman.txt`. Web UI + a clean provider
> abstraction so the 6 agents can be **demo heuristics**, the **Claude API**, or
> **six separate Claude Code / Codex / Gemini sessions**.

## Quick start (zero config)

```bash
npm install
npm start
# open http://localhost:8787  → play immediately against demo agents
```

The default `demo` backend needs no API key — great for learning the flow and
testing the loop. Try a full game headless first:

```bash
npm run sim          # plays a whole game to stdout
npm run sim -- 42    # fixed seed
npm test             # 15 tests: setup, audit, all 4 outcomes, full-game
```

## Three AI backends

Set `WIH_AGENT_BACKEND` (or pick it in the UI dropdown, or `.env`):

| Backend | What drives the 6 agents | Needs |
|---|---|---|
| `demo` *(default)* | Heuristic agents | nothing |
| `api` | Anthropic Messages API, one key for all six | `ANTHROPIC_API_KEY` |
| `file` | Six separate coding-agent sessions (Claude Code / Codex / Gemini) via an inbox/outbox bridge | the CLI(s) — see below |

```bash
# API backend
cp .env.example .env        # then put your key in ANTHROPIC_API_KEY
WIH_AGENT_BACKEND=api npm start

# File backend — six real coding agents (see docs/setup-claude-code-agents.md)
WIH_AGENT_BACKEND=file npm start          # terminal 1
./tools/start-all-agents.sh claude        # terminal 2 (Windows: tools\start-all-agents.ps1)
```

Model for the `api` backend defaults to `claude-opus-4-8`; downgrade with
`WIH_MODEL=claude-sonnet-5` (or `claude-haiku-4-5`) to save cost while testing.

## Languages

The whole game is multilingual — UI, moderator narration, decision prompts, and
the AI agents' speech. Pick a language in the top-bar selector (English,
Español, 简体中文, 한국어, हिन्दी, Français). For the `api`/`file` backends the
agents are instructed to talk in the chosen language (player ids and enums stay
ASCII); the `demo` backend uses localized templates.

All strings live in one file, `public/messages.json` (one flat map per locale;
the server reads it, the browser fetches it, English is the fallback). To add a
language: add an entry to `LOCALES` in `src/i18n/catalog.ts` and a matching block
in `public/messages.json`.

## How to play

1. You're assigned a random werewolf role and a fake **agent profile** to
   imitate — both shown in the right sidebar.
2. Play the werewolf game normally (night actions, discussion, votes) through the
   input bar — **but talk like an AI agent**, not like a person.
3. When the game ends, the six agents each secretly name the human. Get **4+
   votes → detected**.

```
faction win  + hidden   → PERFECT VICTORY     (2 pts)
faction win  + caught    → FACTION VICTORY      (1)
faction loss + hidden    → INFILTRATION VICTORY (1)
faction loss + caught    → TOTAL DEFEAT         (0)
```

## Docs

- [`docs/setup-claude-code-agents.md`](docs/setup-claude-code-agents.md) — connect Claude Code / Codex / Gemini agents (the file bridge). **← the tutorial**
- [`docs/human-among-agents-rules.md`](docs/human-among-agents-rules.md) — full rules
- [`docs/architecture.md`](docs/architecture.md) — modules, provider abstraction, data flow

## Project layout

```
src/
  domain/        types + fixed data (profiles, role briefs)
  engine/        deterministic rules (setup, win checks, validation, resolution)
  agents/        provider abstraction: demo | api | file | human + factory
  orchestrator/  the moderator/game loop + SSE event shapes
  server/        Express + SSE + JSONL match log
public/          web client (no build step)
tools/           agent-runner.* + start-all-agents.* for the file backend
tests/           setup, audit, outcome-matrix, full-game
```

## Scripts

| command | does |
|---|---|
| `npm start` | run the web server (auto-starts a game) |
| `npm run dev` | same, with reload |
| `npm run sim [-- <seed>]` | play a full game headless to stdout |
| `npm test` | run the test suite |

## Notes

- The engine is authoritative; agents only *propose* actions, which the
  moderator validates and coerces to legal moves — a bad/late agent reply never
  hangs or desyncs the game.
- Each match writes a JSONL log to `logs/game-<seed>.jsonl`.
- Everything is seeded, so a seed replays an identical setup.
