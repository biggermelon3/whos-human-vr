import type {
  AgentProfile,
  HumanBelief,
  LegalOptions,
  Meta,
  NightActionType,
  Phase,
  PlayerId,
  Role,
  RoleBelief,
  SeerReading,
  TranscriptEntry,
} from "../domain/types.js";

export type DecisionKind =
  | "NIGHT_ACTION"
  | "OPENING_STATEMENT"
  | "DISCUSSION"
  | "FINAL_DEFENSE"
  | "LYNCH_VOTE"
  | "HUMAN_AUDIT";

export interface SelfView {
  playerId: PlayerId;
  role: Role;
  meta: Meta;
  profile: AgentProfile;
  alive: boolean;
  privateKnowledge: string[];
  roleBeliefs?: Record<PlayerId, RoleBelief>;
  humanBeliefs?: Record<PlayerId, HumanBelief>;
}

export interface PublicView {
  round: number;
  phase: Phase;
  livingPlayers: PlayerId[];
  deadPlayers: Array<{ id: PlayerId; role: Role; cause: string; round: number }>;
  profiles: Record<PlayerId, AgentProfile>;
}

/**
 * A single decision the moderator asks a participant to make. This whole object
 * is what gets written to `inbox/turn-NNN.json` for the file-bridge backend.
 */
export interface DecisionRequest {
  requestId: string;
  kind: DecisionKind;
  instruction: string;
  responseHint: string; // plain-English description of the JSON to return
  locale: import("../i18n/catalog.js").Locale;
  language: string; // human-readable language the reply text must be written in
  self: SelfView;
  publicState: PublicView;
  transcript: TranscriptEntry[];
  options: LegalOptions;
  // How to play this role well (strategy + table-talk). Read this and follow it —
  // it matters more than your persona. Same text the api backend puts in its prompt.
  guidance?: string;
  // kind-specific extras
  seerHistory?: Array<{ round: number; target: PlayerId; reading: SeerReading }>;
  werewolfPartners?: PlayerId[];
  // Behavioral observations of the embodied human in the shared VR space (gaze,
  // hesitation). Present only for AI agents; a strong-but-not-decisive human tell.
  humanSignals?: string[];
}

export interface BeliefUpdate {
  target: PlayerId;
  delta: number;
  reason?: string;
}

/** What a participant returns for a decision (all fields optional per kind). */
export interface DecisionResponse {
  reasoning?: string; // short private rationale (surfaced only in observer mode)
  publicMessage?: string;
  nightAction?: { type: NightActionType; target?: PlayerId };
  lynchVote?: PlayerId | "abstain";
  audit?: { targetPlayerId: PlayerId; confidence: number; evidence: string[] };
  roleBeliefUpdates?: BeliefUpdate[]; // delta on werewolfProbability
  humanBeliefUpdates?: BeliefUpdate[]; // delta on humanProbability
}

export interface AgentProvider {
  readonly kind: string;
  decide(req: DecisionRequest): Promise<DecisionResponse>;
}
