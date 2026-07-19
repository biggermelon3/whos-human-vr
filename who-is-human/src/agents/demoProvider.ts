import type { AgentProvider, BeliefUpdate, DecisionRequest, DecisionResponse } from "./provider.js";
import type { PlayerId } from "../domain/types.js";
import { t } from "../i18n/catalog.js";

/**
 * Zero-config heuristic agent. Produces legal, plausible actions and short
 * in-character messages using the belief state the moderator hands it. No API
 * key, instant — good for exercising the full game loop and for demos.
 */
export class DemoAgentProvider implements AgentProvider {
  readonly kind = "demo";

  async decide(req: DecisionRequest): Promise<DecisionResponse> {
    switch (req.kind) {
      case "NIGHT_ACTION":
        return this.night(req);
      case "OPENING_STATEMENT":
      case "DISCUSSION":
      case "FINAL_DEFENSE":
        return this.talk(req);
      case "LYNCH_VOTE":
        return { lynchVote: this.mostSuspicious(req) ?? "abstain" };
      case "HUMAN_AUDIT":
        return this.audit(req);
    }
  }

  private night(req: DecisionRequest): DecisionResponse {
    const targets = req.options.legalTargets;
    if (targets.length === 0) return { nightAction: { type: "NONE" } };
    const beliefs = req.self.roleBeliefs ?? {};
    if (req.self.role === "werewolf") {
      // Kill the least-suspected player (a probable villager / power role).
      const pick = argmin(targets, (id) => beliefs[id]?.werewolfProbability ?? 0.5, req);
      return { nightAction: { type: "WEREWOLF_KILL", target: pick } };
    }
    if (req.self.role === "seer") {
      const pick = argmax(targets, (id) => beliefs[id]?.werewolfProbability ?? 0.5, req);
      return { nightAction: { type: "SEER_INSPECT", target: pick } };
    }
    if (req.self.role === "doctor") {
      // Protect self if legal, else the most-trusted living player.
      const self = req.self.playerId;
      const pick = targets.includes(self)
        ? self
        : argmin(targets, (id) => beliefs[id]?.werewolfProbability ?? 0.5, req);
      return { nightAction: { type: "DOCTOR_PROTECT", target: pick } };
    }
    return { nightAction: { type: "NONE" } };
  }

  private talk(req: DecisionRequest): DecisionResponse {
    // When defending yourself, push back instead of accusing.
    if (req.kind === "FINAL_DEFENSE") {
      const key = hash(req.requestId + req.self.playerId) % 2 === 0 ? "demo.defense1" : "demo.defense2";
      return { publicMessage: t(req.locale, key, { fn: req.self.profile.functionName }) };
    }
    const suspect = this.mostSuspicious(req);
    const msg = suspect
      ? lineFor(req, suspect)
      : t(req.locale, "demo.nocomment", { fn: req.self.profile.functionName });

    const roleBeliefUpdates: BeliefUpdate[] = suspect
      ? [{ target: suspect, delta: 0.08, reason: "flagged this round" }]
      : [];
    // Occasionally register a human-suspicion on a pseudo-random other so the
    // final audit has some signal to work with.
    const others = req.publicState.livingPlayers.filter((id) => id !== req.self.playerId);
    const humanBeliefUpdates: BeliefUpdate[] = [];
    if (others.length && hash(req.requestId + req.self.playerId) % 3 === 0) {
      const target = others[hash(req.requestId + "h") % others.length]!;
      humanBeliefUpdates.push({ target, delta: 0.05, reason: t(req.locale, "demo.human_reason") });
    }

    return {
      publicMessage: msg,
      lynchVote: suspect ?? "abstain",
      roleBeliefUpdates,
      humanBeliefUpdates,
    };
  }

  private audit(req: DecisionRequest): DecisionResponse {
    const beliefs = req.self.humanBeliefs ?? {};
    const candidates = Object.keys(req.publicState.profiles).filter((id) => id !== req.self.playerId);
    const target = argmax(candidates, (id) => beliefs[id]?.humanProbability ?? 1 / 6, req);
    const conf = clamp01(beliefs[target ?? ""]?.humanProbability ?? 1 / 6);
    const evidence = (beliefs[target ?? ""]?.evidence ?? []).slice(0, 3);
    return {
      audit: {
        targetPlayerId: target ?? candidates[0]!,
        confidence: conf,
        evidence: evidence.length ? evidence : [t(req.locale, "demo.audit_evidence")],
      },
    };
  }

  private mostSuspicious(req: DecisionRequest): PlayerId | undefined {
    const beliefs = req.self.roleBeliefs ?? {};
    const others = req.publicState.livingPlayers.filter((id) => id !== req.self.playerId);
    if (others.length === 0) return undefined;
    // Werewolves never point at a partner.
    const partners = new Set(req.werewolfPartners ?? []);
    const pool = others.filter((id) => !partners.has(id));
    const finalPool = pool.length ? pool : others;
    return argmax(finalPool, (id) => beliefs[id]?.werewolfProbability ?? 0.5, req);
  }
}

// ── helpers ──────────────────────────────────────────────────
function lineFor(req: DecisionRequest, suspect: PlayerId): string {
  const fn = req.self.profile.functionName;
  const keys = ["demo.line1", "demo.line2", "demo.line3", "demo.line4", "demo.line5", "demo.line6", "demo.line7", "demo.line8"];
  const key = keys[hash(req.requestId + suspect) % keys.length]!;
  return t(req.locale, key, { suspect, fn });
}

function argmax(ids: PlayerId[], score: (id: PlayerId) => number, req: DecisionRequest): PlayerId | undefined {
  return extreme(ids, score, req, +1);
}
function argmin(ids: PlayerId[], score: (id: PlayerId) => number, req: DecisionRequest): PlayerId | undefined {
  return extreme(ids, score, req, -1);
}
function extreme(
  ids: PlayerId[],
  score: (id: PlayerId) => number,
  req: DecisionRequest,
  dir: 1 | -1,
): PlayerId | undefined {
  if (ids.length === 0) return undefined;
  let best = ids[0]!;
  let bestScore = score(best) * dir;
  for (const id of ids.slice(1)) {
    const s = score(id) * dir;
    // deterministic tie-break by hashed requestId
    if (s > bestScore || (s === bestScore && hash(req.requestId + id) % 2 === 0)) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
