import type { AgentProvider, DecisionRequest, DecisionResponse } from "./provider.js";

interface Pending {
  req: DecisionRequest;
  resolve: (r: DecisionResponse) => void;
}

/**
 * The human player. `decide()` parks a promise and emits an "awaiting input"
 * signal; the web server fulfils it when the player submits their move.
 */
export class HumanWebProvider implements AgentProvider {
  readonly kind = "human";
  private pending: Pending | undefined;
  private onPrompt: (req: DecisionRequest) => void = () => {};

  setPromptListener(fn: (req: DecisionRequest) => void): void {
    this.onPrompt = fn;
  }

  /** The request currently awaiting the human (for a late-joining UI). */
  currentPrompt(): DecisionRequest | undefined {
    return this.pending?.req;
  }

  decide(req: DecisionRequest): Promise<DecisionResponse> {
    return new Promise<DecisionResponse>((resolve) => {
      this.pending = { req, resolve };
      this.onPrompt(req);
    });
  }

  /** Called by the server when the human submits input. Returns false if stale. */
  submit(requestId: string, response: DecisionResponse): boolean {
    if (!this.pending || this.pending.req.requestId !== requestId) return false;
    const { resolve } = this.pending;
    this.pending = undefined;
    resolve(response);
    return true;
  }
}
