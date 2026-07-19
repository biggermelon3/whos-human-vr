import type {
  AuditBallot,
  FinalOutcome,
  GameResult,
  GameState,
  PlayerId,
  SeerReading,
  StandardOutcome,
} from "../domain/types.js";
import type { Rng } from "../util/rng.js";
import { checkFactionOutcome, humanFactionWon } from "./winConditions.js";
import { player } from "./validation.js";

const NUM_AI_AGENTS = 6;

/** Tally a vote map (ignoring abstains) → sorted [target, count] plus leaders. */
export function tallyVotes(
  votes: Record<PlayerId, PlayerId | "abstain">,
): { counts: Array<[PlayerId, number]>; leaders: PlayerId[]; top: number } {
  const tally: Record<PlayerId, number> = {};
  for (const target of Object.values(votes)) {
    if (target === "abstain") continue;
    tally[target] = (tally[target] ?? 0) + 1;
  }
  const counts = Object.entries(tally).sort((a, b) => b[1] - a[1]) as Array<[PlayerId, number]>;
  const top = counts.length ? counts[0]![1] : 0;
  const leaders = counts.filter(([, c]) => c === top).map(([id]) => id);
  return { counts, leaders, top };
}

/** What the seer learns about a target. */
export function seerReadingOf(state: GameState, target: PlayerId): SeerReading {
  return player(state, target)?.role === "werewolf" ? "werewolf_aligned" : "not_werewolf_aligned";
}

/**
 * Resolve the night: werewolves' agreed kill vs the doctor's protection.
 * Mutates `state.players` and `state.night`. Returns the id that died, if any.
 */
export function resolveNight(state: GameState, rng: Rng): PlayerId | undefined {
  // Exactly ONE kill per night. If the human is a werewolf, their chosen target
  // always dies; otherwise pick one of the wolves' targets (their agreed pick wins,
  // a disagreement is broken randomly).
  const humanKill = player(state, state.humanId)?.role === "werewolf"
    ? state.night.kills[state.humanId]
    : undefined;
  let killTarget: PlayerId | undefined = humanKill;
  if (!killTarget) {
    const { leaders } = tallyVotes(state.night.kills);
    killTarget = leaders.length ? rng.pick(leaders) : undefined;
  }
  const saved = killTarget !== undefined && killTarget === state.night.protectedTarget;

  let died: PlayerId | undefined;
  if (killTarget && !saved) {
    const victim = player(state, killTarget);
    if (victim?.alive) {
      victim.alive = false;
      victim.eliminatedRound = state.round;
      victim.eliminatedCause = "night_kill";
      died = killTarget;
    }
  }

  state.night.resolvedDeath = died;
  state.night.lastProtectedTarget = state.night.protectedTarget;
  return died;
}

/** Eliminate a lynched player. Mutates state. */
export function resolveLynch(state: GameState, target: PlayerId): void {
  const p = player(state, target);
  if (p?.alive) {
    p.alive = false;
    p.eliminatedRound = state.round;
    p.eliminatedCause = "lynch";
  }
}

export function standardOutcomeOrContinue(state: GameState): StandardOutcome | undefined {
  return checkFactionOutcome(state);
}

export function detectionThreshold(): number {
  // Strict majority of the six AI ballots → 4.
  return Math.floor(NUM_AI_AGENTS / 2) + 1;
}

/**
 * Combine the standard-game outcome with the hidden audit into the final
 * 2×2 result and score (faction win = 1pt, undetected = 1pt).
 */
export function computeResult(
  state: GameState,
  standardOutcome: StandardOutcome,
  ballots: AuditBallot[],
): GameResult {
  const humanId = state.humanId;
  const factionWon = humanFactionWon(state, standardOutcome);

  const votesAgainstHuman = ballots.filter((b) => b.targetPlayerId === humanId).length;
  const threshold = detectionThreshold();
  const detected = votesAgainstHuman >= threshold;

  let finalOutcome: FinalOutcome;
  if (factionWon && !detected) finalOutcome = "perfect_victory";
  else if (factionWon && detected) finalOutcome = "faction_victory";
  else if (!factionWon && !detected) finalOutcome = "infiltration_victory";
  else finalOutcome = "total_defeat";

  const score = (factionWon ? 1 : 0) + (detected ? 0 : 1);

  return {
    standardOutcome,
    humanPlayer: humanId,
    humanFactionWon: factionWon,
    auditBallots: ballots,
    votesAgainstHuman,
    detectionThreshold: threshold,
    humanDetected: detected,
    finalOutcome,
    score,
  };
}
