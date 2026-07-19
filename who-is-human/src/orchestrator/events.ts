import type {
  GameResult,
  GameState,
  Phase,
  Player,
  PlayerId,
  Role,
  TranscriptEntry,
} from "../domain/types.js";
import type { DecisionRequest } from "../agents/provider.js";
import { localizedProfile, t, type Locale } from "../i18n/catalog.js";

export interface PlayerCard {
  id: PlayerId;
  alive: boolean;
  functionName: string;
  isYou: boolean;
  revealedRole?: Role; // populated when dead or at game end
  revealedRoleLabel?: string; // localized
  eliminatedCause?: "night_kill" | "lynch";
}

export interface SelfCard {
  id: PlayerId;
  role: Role;
  roleLabel: string; // localized
  functionName: string;
  communicationStyle: string;
  knownLimitation: string;
  alive: boolean;
  privateNotes: string[];
}

export interface Snapshot {
  round: number;
  phase: Phase;
  humanId: PlayerId;
  players: PlayerCard[];
  you: SelfCard;
  gameOver: boolean;
}

export type GameEvent =
  | { type: "game_start"; humanId: PlayerId; seed: number; backend: string; maxDays: number; locale: Locale }
  | { type: "turn"; speaker: PlayerId; kind: string }
  | {
      type: "thought";
      speaker: PlayerId;
      round: number;
      reasoning: string;
      wolf: { id: PlayerId; p: number } | null; // who they most suspect is a werewolf
      human: { id: PlayerId; p: number } | null; // who they most suspect is the human
    }
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "private"; round: number; text: string }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "awaiting_input"; request: DecisionRequest }
  | { type: "input_cleared" }
  | { type: "result"; result: GameResult; reveal: PlayerCard[] }
  | { type: "error"; text: string };

export function buildSnapshot(state: GameState, reveal = false, locale: Locale = "en"): Snapshot {
  const humanId = state.humanId;
  const human = state.players.find((p) => p.id === humanId)!;
  const humanProfile = localizedProfile(human.id, locale);
  const players: PlayerCard[] = state.players.map((p) => {
    const shown = reveal || !p.alive;
    return {
      id: p.id,
      alive: p.alive,
      functionName: localizedProfile(p.id, locale).functionName,
      isYou: p.id === humanId,
      revealedRole: shown ? p.role : undefined,
      revealedRoleLabel: shown ? t(locale, `role.${p.role}`) : undefined,
      eliminatedCause: p.eliminatedCause,
    };
  });
  return {
    round: state.round,
    phase: state.phase,
    humanId,
    players,
    you: {
      id: human.id,
      role: human.role,
      roleLabel: t(locale, `role.${human.role}`),
      functionName: humanProfile.functionName,
      communicationStyle: humanProfile.communicationStyle,
      knownLimitation: humanProfile.knownLimitation,
      alive: human.alive,
      privateNotes: [], // filled by orchestrator via private events
    },
    gameOver: state.phase === "game_over",
  };
}

export function revealAll(players: Player[], humanId: PlayerId, locale: Locale = "en"): PlayerCard[] {
  return players.map((p) => ({
    id: p.id,
    alive: p.alive,
    functionName: localizedProfile(p.id, locale).functionName,
    isYou: p.id === humanId,
    revealedRole: p.role,
    revealedRoleLabel: t(locale, `role.${p.role}`),
    eliminatedCause: p.eliminatedCause,
  }));
}
