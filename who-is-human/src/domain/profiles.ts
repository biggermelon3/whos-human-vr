import type { AgentProfile, PlayerId, Role } from "./types.js";

/**
 * Seven public cover identities. The human is handed one of these and must
 * imitate it; the six AI agents each hold one too. Identity is decoupled from
 * werewolf role — a profile says nothing about who is a werewolf.
 */
export const AGENT_PROFILES: Record<PlayerId, AgentProfile> = {
  "A-01": {
    designation: "A-01",
    functionName: "Social Prediction Agent",
    communicationStyle: "Warm, reads group dynamics, talks about people",
    knownLimitation: "Overweights social signals, weak on hard logic",
  },
  "A-02": {
    designation: "A-02",
    functionName: "Logic Verification Agent",
    communicationStyle: "Formal, step-by-step, cites contradictions",
    knownLimitation: "Rigid; struggles with bluffs and ambiguity",
  },
  "A-03": {
    designation: "A-03",
    functionName: "Memory & Consistency Agent",
    communicationStyle: "Quotes earlier statements, tracks who said what",
    knownLimitation: "Slow to form new reads; anchors on the record",
  },
  "A-04": {
    designation: "A-04",
    functionName: "Risk Evaluation Agent",
    communicationStyle: "Probabilistic, hedged, talks in expected value",
    knownLimitation: "Rarely commits; avoids strong accusations",
  },
  "A-05": {
    designation: "A-05",
    functionName: "Linguistic Pattern Agent",
    communicationStyle: "Clipped, analyzes phrasing and word choice",
    knownLimitation: "Misses intent; over-reads surface style",
  },
  "A-06": {
    designation: "A-06",
    functionName: "Cooperative Planning Agent",
    communicationStyle: "Proposes plans, seeks consensus, de-escalates",
    knownLimitation: "Conflict-averse; can be led by a confident voice",
  },
  "A-07": {
    designation: "A-07",
    functionName: "Evidence Analysis Agent",
    communicationStyle: "Concise, literal, evidence-first",
    knownLimitation: "Poor emotional inference",
  },
};

export const ALL_PLAYER_IDS: PlayerId[] = Object.keys(AGENT_PROFILES);

/** Short, model-facing description of each werewolf role and its night power. */
export const ROLE_BRIEF: Record<Role, string> = {
  werewolf:
    "Werewolf (Village enemy). Each night the werewolves agree on one player to eliminate. You win when living werewolves are >= living non-werewolves.",
  seer: "Seer (Village). Each night you inspect one player and learn only 'werewolf-aligned' or 'not werewolf-aligned'. Village wins when all werewolves are eliminated.",
  doctor:
    "Doctor (Village). Each night you protect one player (may be yourself) from being killed. You cannot protect the same player two nights in a row.",
  villager:
    "Villager (Village). No night power. Win by deducing and voting out both werewolves during the day.",
};

export const RULES_SUMMARY = `SEVEN-PLAYER SETUP: 2 Werewolves, 1 Seer, 1 Doctor, 3 Villagers.
Standard win: Village eliminates all werewolves; Werewolves reach parity (living werewolves >= living non-werewolves).
HIDDEN LAYER: exactly one of the seven participants is a HUMAN pretending to be an AI agent; the other six are AI. Do NOT discuss the human-audit during the standard game. After the standard game ends, the six AI agents each secretly vote for who they believe was the human.`;
