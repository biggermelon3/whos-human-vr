import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/** Append-only JSONL match log — one file per game. */
export class JsonlLogger {
  private path: string;

  constructor(dir: string, seed: number) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `game-${seed}.jsonl`);
  }

  log(record: Record<string, unknown>): void {
    try {
      appendFileSync(this.path, JSON.stringify({ ts: null, ...record }) + "\n", "utf8");
    } catch (err) {
      console.error("[log] write failed:", (err as Error).message);
    }
  }

  get file(): string {
    return this.path;
  }
}
