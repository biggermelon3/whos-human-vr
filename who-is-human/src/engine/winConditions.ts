import type { GameState, Player, StandardOutcome } from "../domain/types.js";

export function livingWerewolves(players: Player[]): Player[] {
  return players.filter((p) => p.alive && p.role === "werewolf");
}

export function livingNonWerewolves(players: Player[]): Player[] {
  return players.filter((p) => p.alive && p.role !== "werewolf");
}

/**
 * Standard win check. Returns the decisive outcome, or undefined if the game
 * should continue.
 */
export function checkFactionOutcome(state: GameState): StandardOutcome | undefined {
  const ww = livingWerewolves(state.players).length;
  const others = livingNonWerewolves(state.players).length;
  if (ww === 0) return "village_win";
  if (ww >= others) return "werewolves_win";
  return undefined;
}

/** Did the human's own faction achieve the standard win? */
export function humanFactionWon(state: GameState, outcome: StandardOutcome): boolean {
  const human = state.players.find((p) => p.id === state.humanId)!;
  if (outcome === "village_win") return human.faction === "village";
  if (outcome === "werewolves_win") return human.faction === "werewolves";
  return false; // draw → neither faction "won"
}
