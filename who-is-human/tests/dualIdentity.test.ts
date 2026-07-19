import { describe, it, expect } from "vitest";
import { createGame } from "../src/engine/setup.js";
import type { Role } from "../src/domain/types.js";

describe("dual identity setup", () => {
  it("assigns exactly one human and the standard role spread", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createGame({ seed });
      expect(s.players).toHaveLength(7);

      const humans = s.players.filter((p) => p.meta === "human");
      expect(humans).toHaveLength(1);
      expect(humans[0]!.id).toBe(s.humanId);

      const counts: Record<Role, number> = { werewolf: 0, seer: 0, doctor: 0, villager: 0 };
      for (const p of s.players) counts[p.role]++;
      expect(counts).toEqual({ werewolf: 2, seer: 1, doctor: 1, villager: 3 });

      // faction follows role
      for (const p of s.players) {
        expect(p.faction).toBe(p.role === "werewolf" ? "werewolves" : "village");
      }
    }
  });

  it("makes the human's role independent of their identity (varies across seeds)", () => {
    const humanRoles = new Set<Role>();
    for (let seed = 1; seed <= 100; seed++) {
      const s = createGame({ seed });
      humanRoles.add(s.players.find((p) => p.id === s.humanId)!.role);
    }
    // over 100 seeds the human should land in more than one werewolf role class
    expect(humanRoles.size).toBeGreaterThan(1);
  });

  it("gives each AI agent separate werewolf- and human-suspicion tracks for the other six", () => {
    const s = createGame({ seed: 7 });
    const aiIds = s.players.filter((p) => p.meta === "ai").map((p) => p.id);
    expect(aiIds).toHaveLength(6);
    expect(Object.keys(s.minds).sort()).toEqual([...aiIds].sort());

    for (const id of aiIds) {
      const mind = s.minds[id]!;
      const others = s.players.filter((p) => p.id !== id).map((p) => p.id);
      for (const o of others) {
        expect(mind.roleBeliefs[o]).toBeDefined();
        expect(mind.humanBeliefs[o]).toBeDefined();
        // the two suspicions are stored independently
        expect(mind.roleBeliefs[o]).not.toBe(mind.humanBeliefs[o]);
      }
      expect(mind.roleBeliefs[id]).toBeUndefined(); // no self-belief
    }
  });

  it("is deterministic for a given seed", () => {
    const a = createGame({ seed: 999 });
    const b = createGame({ seed: 999 });
    expect(a.humanId).toBe(b.humanId);
    expect(a.players.map((p) => p.role)).toEqual(b.players.map((p) => p.role));
  });
});
