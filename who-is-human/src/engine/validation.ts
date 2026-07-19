import type { GameState, NightAction, PlayerId, Role } from "../domain/types.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export function player(state: GameState, id: PlayerId) {
  return state.players.find((p) => p.id === id);
}

export function isAlive(state: GameState, id: PlayerId): boolean {
  return !!player(state, id)?.alive;
}

export function roleOf(state: GameState, id: PlayerId): Role | undefined {
  return player(state, id)?.role;
}

/** Validate a night action against the authoritative state. */
export function validateNightAction(state: GameState, action: NightAction): ValidationResult {
  const actor = player(state, action.actor);
  if (!actor) return fail(`unknown actor ${action.actor}`);
  if (!actor.alive) return fail(`${action.actor} is not alive`);

  switch (action.type) {
    case "WEREWOLF_KILL": {
      if (actor.role !== "werewolf") return fail(`${action.actor} is not a werewolf`);
      if (!action.target) return fail("no kill target");
      const t = player(state, action.target);
      if (!t?.alive) return fail("target not alive");
      if (t.role === "werewolf") return fail("cannot kill a werewolf");
      return OK;
    }
    case "SEER_INSPECT": {
      if (actor.role !== "seer") return fail(`${action.actor} is not the seer`);
      if (!action.target) return fail("no inspect target");
      if (action.target === action.actor) return fail("cannot inspect yourself");
      if (!isAlive(state, action.target)) return fail("target not alive");
      return OK;
    }
    case "DOCTOR_PROTECT": {
      if (actor.role !== "doctor") return fail(`${action.actor} is not the doctor`);
      if (!action.target) return fail("no protect target");
      if (!isAlive(state, action.target)) return fail("target not alive");
      if (action.target === state.night.lastProtectedTarget)
        return fail("cannot protect the same target two nights in a row");
      return OK;
    }
    case "NONE":
      return OK;
  }
}

/** Validate a daytime lynch vote. */
export function validateLynchVote(
  state: GameState,
  voter: PlayerId,
  target: PlayerId | "abstain",
): ValidationResult {
  if (!isAlive(state, voter)) return fail(`${voter} cannot vote (not alive)`);
  if (target === "abstain") return OK;
  if (target === voter) return fail("cannot vote for yourself");
  if (!isAlive(state, target)) return fail("target not alive");
  return OK;
}

/** Validate a post-game "who is the human?" audit ballot. */
export function validateAuditBallot(
  state: GameState,
  voter: PlayerId,
  target: PlayerId,
): ValidationResult {
  const v = player(state, voter);
  if (!v) return fail(`unknown voter ${voter}`);
  if (v.meta !== "ai") return fail("only AI agents vote in the audit");
  if (target === voter) return fail("cannot vote for yourself");
  if (!player(state, target)) return fail(`unknown target ${target}`);
  return OK; // dead / eliminated participants are legal targets
}
