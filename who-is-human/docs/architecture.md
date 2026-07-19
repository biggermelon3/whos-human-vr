# Architecture

The systems the design doc asked to keep separate are separate. Agents never
touch authoritative state — they return proposed actions that the moderator
validates and applies through the deterministic engine.

```
                        ┌──────────────────────────────────────────┐
  Browser (the human)   │  Orchestrator / Moderator                │
   EventSource  ◄───SSE─┤   - drives phases (night → day → audit)   │
   POST /api/input ─────┤   - builds DecisionRequests               │
                        │   - validates & coerces every response    │
                        │   - evolves per-agent belief state        │
                        └───────┬───────────────────────┬──────────┘
                                │ propose               │ apply (validated)
                                ▼                        ▼
                     ┌────────────────────┐   ┌────────────────────────┐
                     │  AgentProvider(s)  │   │  Deterministic engine  │
                     │  demo / api / file │   │  setup · winConditions │
                     │  / human (web)     │   │  validation · resolve  │
                     └────────────────────┘   └────────────────────────┘
```

## Modules

| Path | Responsibility |
|---|---|
| `src/domain/` | Types (`types.ts`) and the fixed data: 7 agent profiles, role briefs (`profiles.ts`). |
| `src/engine/` | Pure rules. `setup.ts` (role/identity assignment), `winConditions.ts`, `validation.ts` (is this move legal?), `engine.ts` (night/lynch resolution, audit threshold, final-result matrix). No I/O, no LLM. |
| `src/agents/` | The provider abstraction. `provider.ts` (the `DecisionRequest`/`DecisionResponse` contract), `prompts.ts` (prompt + JSON-schema + robust parse), `demoProvider.ts`, `claudeApiProvider.ts`, `fileProvider.ts`, `humanWebProvider.ts`, `factory.ts`. |
| `src/orchestrator/` | `orchestrator.ts` (the moderator/game loop) and `events.ts` (the SSE event + snapshot shapes). |
| `src/server/` | `server.ts` (Express + SSE + REST), `log.ts` (JSONL match log). |
| `public/` | The web client (no build step). |
| `tools/` | The Claude Code / Codex / Gemini runner scripts. |

## The provider abstraction

Every participant is a `AgentProvider` with one method:

```ts
decide(req: DecisionRequest): Promise<DecisionResponse>
```

Four implementations, chosen per `WIH_AGENT_BACKEND`:

- **DemoAgentProvider** — heuristic, no API. Uses the belief state the moderator
  hands it. Zero-config, deterministic, drives the sim + tests.
- **ClaudeApiProvider** — one Anthropic API key powers all six agents. Uses
  structured outputs (`output_config.format`) so replies are schema-valid.
- **FileAgentProvider** — the inbox/outbox bridge (one folder per agent). A
  separate coding-agent session answers each turn. Kept intentionally isolated
  from any future HTTP provider.
- **HumanWebProvider** — parks a promise and emits `awaiting_input`; the browser
  fulfils it via `POST /api/input`.

The human is bound to whichever slot `createGame` picked as `human`; the other
six are bound to the chosen AI backend.

## Two separate belief tracks (the core idea)

Each AI agent's `AgentMind` keeps, for every other participant:

- `roleBeliefs[x].werewolfProbability` — "is x a werewolf?"
- `humanBeliefs[x].humanProbability` + `evidence[]` — "is x the human?"

These evolve independently as agents return `roleBeliefUpdates` /
`humanBeliefUpdates` each turn. Only the structured summary is kept — never the
model's raw chain-of-thought. This is what lets an agent believe "x is probably a
villager, but very likely the human," or the reverse — the quantifiable social
signal the whole experiment is about.

## Data flow of one decision

1. Orchestrator builds a `DecisionRequest` (self view + public view + transcript
   + legal options).
2. It calls `provider.decide(req)`. For `file`, the request is written to
   `inbox/turn-NNN.json`; for `api`, it's a Messages API call; for the human,
   it's emitted to the browser.
3. The response is **validated** against the engine (`validate*`) and, if
   illegal/missing, **coerced** to a safe legal move — the game can never hang
   or desync on a bad agent reply.
4. Belief updates are applied to the agent's mind. Public messages/votes/deaths
   go into the transcript and stream to the browser.

## Determinism

`createGame(seed)` and all tie-breaks use a seeded PRNG (`util/rng.ts`), so a
seed replays an identical setup and identical demo game — handy for tests and
shareable match seeds.
