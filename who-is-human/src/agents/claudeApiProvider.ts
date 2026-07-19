import Anthropic from "@anthropic-ai/sdk";
import type { AgentProvider, DecisionRequest, DecisionResponse } from "./provider.js";
import {
  buildSystemPrompt,
  buildUserContent,
  extractJson,
  normaliseResponse,
  schemaForKind,
} from "./prompts.js";

/**
 * Drives an AI agent with the Anthropic Messages API. One key powers all six
 * agents. Uses structured outputs so the model must return schema-valid JSON.
 */
export class ClaudeApiProvider implements AgentProvider {
  readonly kind = "api";
  private client: Anthropic;
  private model: string;
  private useThinking: boolean;

  constructor(opts: { apiKey?: string; model?: string; thinking?: boolean } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["WIH_MODEL"] ?? "claude-opus-4-8";
    // A little thinking by default (low effort) so agents actually reason about the
    // transcript + the human's tells, and so turns stagger naturally instead of
    // firing all at once. Set WIH_THINKING=0 to turn it off.
    this.useThinking = opts.thinking ?? process.env["WIH_THINKING"] !== "0";
  }

  async decide(req: DecisionRequest): Promise<DecisionResponse> {
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.useThinking ? 6000 : 1500,
      system: buildSystemPrompt(req),
      messages: [{ role: "user", content: buildUserContent(req) }],
      output_config: {
        format: { type: "json_schema", schema: schemaForKind(req) },
      },
    };
    if (this.useThinking) {
      params["thinking"] = { type: "adaptive" };
      (params["output_config"] as Record<string, unknown>)["effort"] = "low";
    }

    try {
      // Cast: output_config typing varies across SDK minor versions.
      const res = await this.client.messages.create(params as never);
      const text = firstText(res);
      return normaliseResponse(extractJson(text));
    } catch (err) {
      console.error(`[api:${req.self.playerId}] ${req.kind} failed:`, (err as Error).message);
      return {}; // moderator coerces to a safe legal default
    }
  }
}

function firstText(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "{}";
}
