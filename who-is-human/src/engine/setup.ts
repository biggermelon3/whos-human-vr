import type { Config, GameState, Meta, Player, PlayerId, Role } from "../domain/types.js";
import { AGENT_PROFILES, ALL_PLAYER_IDS } from "../domain/profiles.js";
import { makeRng, type Rng } from "../util/rng.js";
import type { Locale } from "../i18n/catalog.js";

const ROLE_DECK: Role[] = [
  "werewolf",
  "werewolf",
  "seer",
  "doctor",
  "villager",
  "villager",
  "villager",
];

export interface NewGameOptions {
  seed?: number;
  maxDays?: number;
  discussionRounds?: number;
  /** Force which designation the human occupies (default: random). */
  humanId?: PlayerId;
  locale?: Locale;
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const config: Config = {
    seed,
    maxDays: opts.maxDays ?? 5,
    // One open-discussion pass by default: each living player speaks exactly once
    // in free discussion (plus one opening statement earlier). Keeps a day short
    // and readable in VR; raise via NewGameOptions / POST /api/new to lengthen it.
    discussionRounds: opts.discussionRounds ?? 1,
    locale: opts.locale ?? "en",
  };
  const rng = makeRng(seed);

  const ids = [...ALL_PLAYER_IDS];
  const roles = rng.shuffle([...ROLE_DECK]);
  const humanId = opts.humanId ?? rng.pick(ids);

  const players: Player[] = ids.map((id, i) => {
    const role = roles[i]!;
    const meta: Meta = id === humanId ? "human" : "ai";
    return {
      id,
      role,
      meta,
      faction: role === "werewolf" ? "werewolves" : "village",
      alive: true,
      profile: AGENT_PROFILES[id]!,
    };
  });

  const state: GameState = {
    config,
    round: 0,
    phase: "setup",
    players,
    humanId,
    transcript: [],
    minds: {},
    night: { kills: {}, seerInspections: {} },
    day: { lynchVotes: {}, preVotes: {}, defendants: [] },
  };

  for (const p of players) {
    if (p.meta === "ai") state.minds[p.id] = initMind(p, players, rng);
  }
  return state;
}

function initMind(self: Player, players: Player[], rng: Rng) {
  const roleBeliefs: Record<PlayerId, ReturnType<typeof neutralRoleBelief>> = {};
  const humanBeliefs: Record<PlayerId, { humanProbability: number; evidence: string[] }> = {};
  for (const p of players) {
    if (p.id === self.id) continue;
    roleBeliefs[p.id] = neutralRoleBelief();
    // Prior: 1 human among the other 6 participants → ~1/6.
    humanBeliefs[p.id] = { humanProbability: 1 / 6, evidence: [] };
  }

  const privateKnowledge: string[] = [`You are ${self.id}, an AI agent. Your werewolf role: ${self.role}.`];
  if (self.role === "werewolf") {
    const partners = players.filter((p) => p.role === "werewolf" && p.id !== self.id).map((p) => p.id);
    privateKnowledge.push(`Your werewolf partner(s): ${partners.join(", ") || "(none)"}.`);
  }

  return {
    agentId: self.id,
    role: self.role,
    alive: true,
    personality: {
      assertiveness: round2(rng.next()),
      skepticism: round2(rng.next()),
      conformity: round2(rng.next()),
      riskTolerance: round2(rng.next()),
    },
    roleBeliefs,
    humanBeliefs,
    privateKnowledge,
  };
}

function neutralRoleBelief() {
  return { werewolfProbability: 2 / 6, trust: 0, threat: 0.3 };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
