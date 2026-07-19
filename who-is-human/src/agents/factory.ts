import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GameState, PlayerId } from "../domain/types.js";
import type { AgentProvider } from "./provider.js";
import { DemoAgentProvider } from "./demoProvider.js";
import { ClaudeApiProvider } from "./claudeApiProvider.js";
import { FileAgentProvider } from "./fileProvider.js";

export type Backend = "demo" | "api" | "file";

export function resolveBackend(explicit?: string): Backend {
  const b = (explicit ?? process.env["WIH_AGENT_BACKEND"] ?? "demo").toLowerCase();
  if (b === "api" || b === "file") return b;
  return "demo";
}

/**
 * Build the full playerId → provider map. The human slot is bound to the passed
 * humanProvider; the other six are driven by the chosen AI backend.
 *
 * `apiKey` is the optional BYOK (bring-your-own-key) Anthropic key sent per game
 * from the client. It takes precedence over the ANTHROPIC_API_KEY env var, is
 * kept only in the ClaudeApiProvider instance for this game's lifetime, and is
 * NEVER logged or echoed back to clients.
 */
export function buildProviders(
  state: GameState,
  humanProvider: AgentProvider,
  backend: Backend,
  apiKey?: string,
): { providers: Map<PlayerId, AgentProvider>; effectiveBackend: Backend; note?: string } {
  let effective = backend;
  let note: string | undefined;

  // shared instances where the provider is stateless
  let sharedAi: AgentProvider | undefined;
  if (backend === "demo") {
    sharedAi = new DemoAgentProvider();
  } else if (backend === "api") {
    // BYOK key from the request wins; otherwise fall back to the server env key.
    const key = (typeof apiKey === "string" && apiKey.trim()) || process.env["ANTHROPIC_API_KEY"];
    if (!key) {
      effective = "demo";
      note = "No Anthropic key (BYOK field empty and ANTHROPIC_API_KEY unset) — using the demo backend.";
      sharedAi = new DemoAgentProvider();
    } else {
      sharedAi = new ClaudeApiProvider({ apiKey: key }); // key stays in-memory here; never logged
    }
  }

  // Anchor the file-backend mailbox to the repo-root `agent-workspace` using THIS
  // module's location (…/src|dist/agents/factory → ../../agent-workspace), never
  // process.cwd(). tools/start-all-agents anchors the runners to the same folder,
  // so requests and replies always meet regardless of where each side was launched.
  const workspace =
    process.env["WIH_AGENT_WORKSPACE"] ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agent-workspace");
  const providers = new Map<PlayerId, AgentProvider>();
  for (const p of state.players) {
    if (p.id === state.humanId) {
      providers.set(p.id, humanProvider);
    } else if (effective === "file") {
      providers.set(p.id, new FileAgentProvider(p.id, workspace));
    } else {
      providers.set(p.id, sharedAi!);
    }
  }
  return { providers, effectiveBackend: effective, note };
}
