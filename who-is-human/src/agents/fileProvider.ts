import { mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProvider, DecisionRequest, DecisionResponse } from "./provider.js";
import { extractJson, normaliseResponse } from "./prompts.js";

/**
 * Temporary testing adapter (doc §"ExternalFileAgentProvider"): the game writes
 * a decision request to `<workspace>/<agentId>/inbox/turn-NNN.json`, then polls
 * `<workspace>/<agentId>/outbox/turn-NNN.json` for the response. A separate
 * Claude Code / Codex / Gemini session (via tools/agent-runner.*) fills it in.
 *
 * Kept deliberately separate from any future HTTP/API provider.
 */
export class FileAgentProvider implements AgentProvider {
  readonly kind = "file";
  private inbox: string;
  private outbox: string;
  private turn = 0;
  private timeoutMs: number;
  private pollMs: number;

  constructor(
    public readonly agentId: string,
    workspaceRoot: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ) {
    const base = join(workspaceRoot, agentId);
    this.inbox = join(base, "inbox");
    this.outbox = join(base, "outbox");
    mkdirSync(this.inbox, { recursive: true });
    mkdirSync(this.outbox, { recursive: true });
    // Clear stale turn files from a previous game so decide() never replays an
    // old reply — turn numbering restarts at 001 every game, so a leftover
    // outbox/turn-001.json would be picked up instantly (no runner needed).
    this.clearStale(this.inbox);
    this.clearStale(this.outbox);
    this.timeoutMs = opts.timeoutMs ?? Number(process.env["WIH_FILE_TIMEOUT_MS"] ?? 180000);
    this.pollMs = opts.pollMs ?? 500;
  }

  /** Remove leftover turn-*.json from a prior game. */
  private clearStale(dir: string): void {
    try {
      for (const f of readdirSync(dir)) {
        if (f.startsWith("turn-")) rmSync(join(dir, f), { force: true });
      }
    } catch {
      /* directory was just created / is empty */
    }
  }

  async decide(req: DecisionRequest): Promise<DecisionResponse> {
    this.turn += 1;
    const name = `turn-${String(this.turn).padStart(3, "0")}.json`;
    const inPath = join(this.inbox, name);
    const outPath = join(this.outbox, name);

    // atomic-ish write: write temp then rename so a watcher never sees a partial file
    const tmp = inPath + ".tmp";
    await writeFile(tmp, JSON.stringify(req, null, 2), "utf8");
    await rename(tmp, inPath);

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(outPath)) {
        try {
          const text = await readFile(outPath, "utf8");
          if (text.trim().length > 0) return normaliseResponse(extractJson(text));
        } catch {
          /* file mid-write; retry */
        }
      }
      await sleep(this.pollMs);
    }
    console.error(`[file:${this.agentId}] ${req.kind} timed out after ${this.timeoutMs}ms — using default`);
    return {}; // moderator coerces to a safe legal default
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
