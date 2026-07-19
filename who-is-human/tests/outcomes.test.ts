import { describe, it, expect } from "vitest";
import { createGame } from "../src/engine/setup.js";
import { computeResult } from "../src/engine/engine.js";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { DemoAgentProvider } from "../src/agents/demoProvider.js";
import { buildProviders } from "../src/agents/factory.js";
import { validateAuditBallot } from "../src/engine/validation.js";
import type { AuditBallot, Faction, GameState, PlayerId, StandardOutcome } from "../src/domain/types.js";
import type { GameEvent } from "../src/orchestrator/events.js";

function forceHumanFaction(state: GameState, faction: Faction): void {
  const human = state.players.find((p) => p.id === state.humanId)!;
  human.faction = faction;
  human.role = faction === "werewolves" ? "werewolf" : "villager";
}
function ballots(state: GameState, against: number): AuditBallot[] {
  const aiIds = state.players.filter((p) => p.meta === "ai").map((p) => p.id);
  const human = state.humanId;
  return aiIds.map((voter, i): AuditBallot => ({
    voter,
    targetPlayerId: i < against ? human : state.players.find((p) => p.id !== voter && p.id !== human)!.id,
    confidence: 0.5,
    evidence: [],
  }));
}

describe("final result matrix (all four outcomes)", () => {
  const cases: Array<{
    name: string;
    faction: Faction;
    standard: StandardOutcome;
    against: number;
    outcome: string;
    score: number;
  }> = [
    { name: "faction win + undetected → Perfect", faction: "village", standard: "village_win", against: 3, outcome: "perfect_victory", score: 2 },
    { name: "faction win + detected → Faction", faction: "village", standard: "village_win", against: 4, outcome: "faction_victory", score: 1 },
    { name: "faction loss + undetected → Infiltration", faction: "village", standard: "werewolves_win", against: 3, outcome: "infiltration_victory", score: 1 },
    { name: "faction loss + detected → Total Defeat", faction: "village", standard: "werewolves_win", against: 4, outcome: "total_defeat", score: 0 },
    { name: "draw + undetected → Infiltration", faction: "village", standard: "draw", against: 0, outcome: "infiltration_victory", score: 1 },
    { name: "draw + detected → Total Defeat", faction: "village", standard: "draw", against: 5, outcome: "total_defeat", score: 0 },
    { name: "werewolf human wins + undetected → Perfect", faction: "werewolves", standard: "werewolves_win", against: 3, outcome: "perfect_victory", score: 2 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const s = createGame({ seed: 100 });
      forceHumanFaction(s, c.faction);
      const r = computeResult(s, c.standard, ballots(s, c.against));
      expect(r.finalOutcome).toBe(c.outcome);
      expect(r.score).toBe(c.score);
    });
  }
});

describe("full demo game integration", () => {
  it("plays several seeds to game_over with a valid, legal result", async () => {
    for (const seed of [1, 42, 777, 2024]) {
      const state = createGame({ seed });
      const human = new DemoAgentProvider();
      const { providers } = buildProviders(state, human, "demo");
      const events: GameEvent[] = [];
      const orch = new Orchestrator(state, providers, { emit: (e) => events.push(e) });
      await orch.run();

      expect(state.phase).toBe("game_over");
      const r = state.result!;
      expect(r).toBeDefined();
      expect(["perfect_victory", "faction_victory", "infiltration_victory", "total_defeat"]).toContain(r.finalOutcome);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(2);

      // exactly six audit ballots, all legal
      expect(r.auditBallots).toHaveLength(6);
      const voters = new Set<PlayerId>();
      for (const b of r.auditBallots) {
        expect(validateAuditBallot(state, b.voter, b.targetPlayerId).ok).toBe(true);
        voters.add(b.voter);
      }
      expect(voters.size).toBe(6); // one ballot per AI agent

      // a result event was emitted
      expect(events.some((e) => e.type === "result")).toBe(true);
    }
  });
});
