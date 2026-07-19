import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Response } from "express";

import { createGame } from "../engine/setup.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import type { GameEvent } from "../orchestrator/events.js";
import { HumanWebProvider } from "../agents/humanWebProvider.js";
import { buildProviders, resolveBackend, type Backend } from "../agents/factory.js";
import { JsonlLogger } from "./log.js";
import { LOCALES, isLocale } from "../i18n/catalog.js";
import type { GameState, PlayerId } from "../domain/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");
const PORT = Number(process.env["PORT"] ?? 8787);

// ── one active game at a time (single-player) ────────────────
interface Session {
  state: GameState;
  human: HumanWebProvider;
  backend: Backend;
  signals: { notes: string[] }; // live behavioral observations of the human (VR gaze/timing)
}
let session: Session | undefined;

const clients = new Set<Response>();
let buffer: Array<Record<string, unknown>> = [];

function broadcast(e: Record<string, unknown>): void {
  buffer.push(e);
  const payload = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of clients) res.write(payload);
}

function startGame(
  opts: { seed?: number; humanId?: PlayerId; backend?: string; maxDays?: number; discussionRounds?: number; locale?: string; apiKey?: string } = {},
): Session {
  // Request locale wins; else the server's WIH_LOCALE env; else English.
  const envLocale = process.env["WIH_LOCALE"];
  const locale = isLocale(opts.locale) ? opts.locale : isLocale(envLocale) ? envLocale : "en";
  const state = createGame({ seed: opts.seed, humanId: opts.humanId, maxDays: opts.maxDays, discussionRounds: opts.discussionRounds, locale });
  const human = new HumanWebProvider();
  const backend = resolveBackend(opts.backend);
  // opts.apiKey is the BYOK Anthropic key — passed straight to the provider, never logged/stored to disk.
  const { providers, effectiveBackend, note } = buildProviders(state, human, backend, opts.apiKey);
  const logger = new JsonlLogger("logs", state.config.seed);

  buffer = []; // fresh event history for the new game
  broadcast({ type: "game_start", humanId: state.humanId, seed: state.config.seed, backend: effectiveBackend, maxDays: state.config.maxDays, locale });
  if (note) broadcast({ type: "error", text: note });

  const signals = { notes: [] as string[] }; // mutated by POST /api/observe, read by the orchestrator
  const orch = new Orchestrator(
    state,
    providers,
    {
      emit: (ev: GameEvent) => broadcast(ev as unknown as Record<string, unknown>),
      log: (rec) => logger.log(rec),
    },
    () => signals.notes,
  );

  session = { state, human, backend: effectiveBackend, signals };
  orch.run().catch((err) => {
    console.error("[game] crashed:", err);
    broadcast({ type: "error", text: `Game crashed: ${(err as Error).message}` });
  });
  console.log(`New game: seed=${state.config.seed} human=${state.humanId} backend=${effectiveBackend} → log ${logger.file}`);
  return session;
}

// ── HTTP ─────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(PUBLIC_DIR));

// Server-Sent Events stream of game events.
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  // replay history so a late/reloaded client catches up
  for (const e of buffer) res.write(`data: ${JSON.stringify(e)}\n\n`);
  // resend a pending human prompt if one is outstanding
  const pending = session?.human.currentPrompt();
  if (pending) res.write(`data: ${JSON.stringify({ type: "awaiting_input", request: pending })}\n\n`);

  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// Human submits a decision.
app.post("/api/input", (req, res) => {
  const { requestId, response } = req.body ?? {};
  if (!session || typeof requestId !== "string") {
    res.status(400).json({ ok: false, error: "no active game or bad requestId" });
    return;
  }
  const ok = session.human.submit(requestId, response ?? {});
  res.json({ ok });
});

// The VR client reports the human's body language (gaze target + dwell, hesitation).
// We turn it into a subtle behavioral note the AI agents may weigh for the human-audit.
// Kept deliberately sparse/tunable so the human still has a chance to hide.
app.post("/api/observe", (req, res) => {
  if (!session) {
    res.status(400).json({ ok: false, error: "no active game" });
    return;
  }
  const human = session.state.humanId;
  const notes: string[] = [];
  const gaze = req.body?.gaze;
  if (gaze && typeof gaze.target === "string" && /^A-0\d$/.test(gaze.target)) {
    const dwell = Number(gaze.dwellMs) || 0;
    if (gaze.target !== human && dwell > 1200) notes.push(`${human} kept glancing at ${gaze.target}.`);
  }
  if (typeof req.body?.hesitationMs === "number" && req.body.hesitationMs > 2500) {
    notes.push(`${human} paused noticeably before responding.`);
  }
  session.signals.notes = notes; // latest wins; empty array clears stale tells
  res.json({ ok: true });
});

// Start / restart a game. `apiKey` (optional) is the player's BYOK Anthropic key:
// used only to construct this game's AI provider, never logged or echoed back.
app.post("/api/new", (req, res) => {
  const { seed, humanId, backend, maxDays, discussionRounds, locale, apiKey } = req.body ?? {};
  const key = typeof apiKey === "string" ? apiKey : undefined;
  const s = startGame({ seed, humanId, backend, maxDays, discussionRounds, locale, apiKey: key });
  // NOTE: the response deliberately does not include the key.
  res.json({ ok: true, humanId: s.state.humanId, seed: s.state.config.seed, backend: s.backend, locale: s.state.config.locale });
});

// Supported UI languages.
app.get("/api/locales", (_req, res) => {
  res.json({ locales: LOCALES });
});

app.get("/api/current", (_req, res) => {
  if (!session) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: true,
    humanId: session.state.humanId,
    seed: session.state.config.seed,
    backend: session.backend,
    locale: session.state.config.locale,
    awaiting: session.human.currentPrompt() ?? null,
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n  Who is Human — http://localhost:${PORT}\n  Backend: ${resolveBackend()} (set WIH_AGENT_BACKEND=demo|api|file)\n  Waiting for a client to start a game (POST /api/new).\n`);
  // No auto-start: the game begins only when a client POSTs /api/new (the VR
  // START menu, or the web page's New Game button).
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  ✗ Port ${PORT} is already in use (another app — e.g. a Vite dev server — may be on it).\n    Run on a different port:  PORT=8899 npm start\n`,
    );
  } else {
    console.error("Server failed to start:", err);
  }
  process.exit(1);
});
