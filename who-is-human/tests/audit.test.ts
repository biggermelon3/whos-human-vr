import { describe, it, expect } from "vitest";
import { createGame } from "../src/engine/setup.js";
import { computeResult, detectionThreshold } from "../src/engine/engine.js";
import { validateAuditBallot } from "../src/engine/validation.js";
import type { AuditBallot, GameState, PlayerId } from "../src/domain/types.js";

/** Build 6 AI ballots, `against` of which name the human. Rest name a decoy. */
function ballots(state: GameState, against: number): AuditBallot[] {
  const aiIds = state.players.filter((p) => p.meta === "ai").map((p) => p.id);
  const human = state.humanId;
  return aiIds.map((voter, i): AuditBallot => {
    const decoy = pickDecoy(state, voter, human);
    return {
      voter,
      targetPlayerId: i < against ? human : decoy,
      confidence: 0.6,
      evidence: ["test"],
    };
  });
}
function pickDecoy(state: GameState, voter: PlayerId, human: PlayerId): PlayerId {
  return state.players.find((p) => p.id !== voter && p.id !== human)!.id;
}

describe("human audit", () => {
  it("needs a strict majority of the six ballots (4/6) to detect", () => {
    expect(detectionThreshold()).toBe(4);
  });

  it("counts only ballots against the human", () => {
    const s = createGame({ seed: 3 });
    const r3 = computeResult(s, "village_win", ballots(s, 3));
    expect(r3.votesAgainstHuman).toBe(3);
    expect(r3.humanDetected).toBe(false);

    const r4 = computeResult(s, "village_win", ballots(s, 4));
    expect(r4.votesAgainstHuman).toBe(4);
    expect(r4.humanDetected).toBe(true);
  });

  it("only accepts AI voters, never self-votes, and allows dead targets", () => {
    const s = createGame({ seed: 5 });
    const ai = s.players.find((p) => p.meta === "ai")!;
    const other = s.players.find((p) => p.id !== ai.id)!;

    expect(validateAuditBallot(s, ai.id, other.id).ok).toBe(true);
    expect(validateAuditBallot(s, ai.id, ai.id).ok).toBe(false); // no self-vote
    expect(validateAuditBallot(s, s.humanId, other.id).ok).toBe(false); // human can't vote

    // dead target is still legal
    other.alive = false;
    expect(validateAuditBallot(s, ai.id, other.id).ok).toBe(true);
  });
});
