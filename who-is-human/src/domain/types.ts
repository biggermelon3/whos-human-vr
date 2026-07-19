// ─────────────────────────────────────────────────────────────
// Domain types — the shared contract for the whole game.
//
// Two independent axes per participant:
//   1. Werewolf ROLE  (werewolf | seer | doctor | villager) → faction win
//   2. Meta IDENTITY  (human | ai)                          → the hidden audit
// Exactly one participant is `human`; the other six are `ai`.
// ─────────────────────────────────────────────────────────────

export type PlayerId = string; // "A-01" … "A-07"

export type Role = "werewolf" | "seer" | "doctor" | "villager";
export type Meta = "human" | "ai";
export type Faction = "village" | "werewolves";

/** Public cover identity everyone (human included) pretends to be. */
export interface AgentProfile {
  designation: string; // "A-07" — same as PlayerId
  functionName: string; // "Evidence Analysis Agent"
  communicationStyle: string; // "Concise, literal, evidence-first"
  knownLimitation: string; // "Poor emotional inference"
}

export interface Player {
  id: PlayerId;
  role: Role;
  meta: Meta;
  faction: Faction;
  alive: boolean;
  profile: AgentProfile;
  /** Set when the player leaves the standard game. */
  eliminatedRound?: number;
  eliminatedCause?: "night_kill" | "lynch";
}

export type Phase =
  | "setup"
  | "night"
  | "day_announce"
  | "day_opening"
  | "day_discussion"
  | "day_defense"
  | "day_vote"
  | "resolve"
  | "audit"
  | "game_over";

// ── Night actions ────────────────────────────────────────────
export type NightActionType =
  | "WEREWOLF_KILL"
  | "SEER_INSPECT"
  | "DOCTOR_PROTECT"
  | "NONE";

export interface NightAction {
  type: NightActionType;
  actor: PlayerId;
  target?: PlayerId;
}

export type SeerReading = "werewolf_aligned" | "not_werewolf_aligned";

// ── Per-agent belief model (structured summary only — no chain-of-thought) ──
export interface RoleBelief {
  werewolfProbability: number; // 0..1
  trust: number; // -1..1
  threat: number; // 0..1
}

export interface HumanBelief {
  humanProbability: number; // 0..1
  evidence: string[];
}

export interface AgentMind {
  agentId: PlayerId;
  role: Role;
  alive: boolean;
  personality: {
    assertiveness: number;
    skepticism: number;
    conformity: number;
    riskTolerance: number;
  };
  roleBeliefs: Record<PlayerId, RoleBelief>;
  humanBeliefs: Record<PlayerId, HumanBelief>;
  /** Facts only this agent legitimately knows (seer results, werewolf partners…). */
  privateKnowledge: string[];
}

// ── Transcript / public record ───────────────────────────────
export type TranscriptKind =
  | "system"
  | "opening"
  | "discussion"
  | "defense"
  | "vote"
  | "death"
  | "result";

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  kind: TranscriptKind;
  speaker?: PlayerId; // omitted for system/moderator lines
  text: string;
}

// ── Post-game "who is human?" audit ──────────────────────────
export interface AuditBallot {
  voter: PlayerId; // an AI agent
  targetPlayerId: PlayerId; // who they think is the human
  confidence: number; // 0..1
  evidence: string[];
}

export type StandardOutcome = "village_win" | "werewolves_win" | "draw";

export type FinalOutcome =
  | "perfect_victory" // faction win + undetected
  | "faction_victory" // faction win + detected
  | "infiltration_victory" // faction loss/draw + undetected
  | "total_defeat"; // faction loss/draw + detected

export interface GameResult {
  standardOutcome: StandardOutcome;
  humanPlayer: PlayerId;
  humanFactionWon: boolean;
  auditBallots: AuditBallot[];
  votesAgainstHuman: number;
  detectionThreshold: number;
  humanDetected: boolean;
  finalOutcome: FinalOutcome;
  score: number; // 0..2
}

// ── Authoritative game state ─────────────────────────────────
export interface Config {
  seed: number;
  maxDays: number; // default 5
  discussionRounds: number; // open-discussion exchanges per day
  locale: import("../i18n/catalog.js").Locale; // UI + narration + agent output language
}

export interface GameState {
  config: Config;
  round: number; // day number, 1-based (0 during setup)
  phase: Phase;
  players: Player[];
  humanId: PlayerId;
  transcript: TranscriptEntry[];
  minds: Record<PlayerId, AgentMind>; // one per AI agent

  // Per-night working state
  night: {
    kills: Record<PlayerId, PlayerId>; // werewolf → intended target
    protectedTarget?: PlayerId;
    lastProtectedTarget?: PlayerId;
    seerInspections: Record<PlayerId, PlayerId>; // seer → target
    resolvedDeath?: PlayerId; // who actually died (or undefined = saved / no kill)
  };

  // Per-day working state
  day: {
    lynchVotes: Record<PlayerId, PlayerId | "abstain">;
    preVotes: Record<PlayerId, PlayerId | "abstain">; // from opening statements
    defendants: PlayerId[];
  };

  result?: GameResult;
}

// ── Legal-move info surfaced to a decision request ───────────
export interface LegalOptions {
  livingPlayers: PlayerId[];
  legalTargets: PlayerId[]; // targets valid for this specific decision
  canAbstain: boolean;
}
