import type { BeliefUpdate, DecisionRequest, DecisionResponse } from "./provider.js";
import { RULES_SUMMARY } from "../domain/profiles.js";
import type { NightActionType, PlayerId, Role } from "../domain/types.js";

// ── How to actually PLAY (not just role-play the persona) ─────
const DISCUSSION_STYLE = `HOW TO PLAY THE DISCUSSION (this matters more than flavour):
Your agent profile is a costume to WEAR, not the goal — the goal is to WIN the werewolf game. Drive the table like a real player:
  • Interrogate: ask pointed questions and push people who dodge — e.g. "You've said nothing concrete — who do YOU suspect and why?", "Why are you being shady?", "Start talking."
  • Read behaviour: call out who is evasive or over-defensive, who steers votes with no evidence, who suddenly flips their story, who defends one specific player too eagerly ("you two are moving together").
  • Build & revise a case: name a prime suspect with a CONCRETE reason, and update it as new claims land. React to what someone JUST said — never monologue your role.
  • Coordinate the village: "We only need to catch ONE wolf — let's lock down X's story," then compare accounts and hunt the contradiction.
Keep each turn to 1–2 sharp sentences, in your communication style, addressing real players by id (A-03 etc.).`;

function roleStrategy(role: Role): string {
  switch (role) {
    case "werewolf":
      return `SECRET STRATEGY — YOU ARE A WEREWOLF. Your faction wins by surviving and thinning the village. HIDE it completely: never admit or hint you are a wolf; talk, reason and vote exactly like a villager who is hunting wolves. Deflect suspicion onto believable targets, cast doubt on quiet or "too clean" players, and quietly avoid burning your werewolf partner — but don't defend them so hard it looks obvious. Sound helpful and analytical while steering the lynch toward villagers and power roles.`;
    case "seer":
      return `SECRET STRATEGY — YOU ARE THE SEER. Your night inspections give you REAL alignment info — use it to steer the village. But openly claiming "I'm the seer" paints a target on you: drop guided hints or build the case first, and hard-claim the seer role only when it will actually swing the vote.`;
    case "doctor":
      return `SECRET STRATEGY — YOU ARE THE DOCTOR. You protect one player each night. Help the village reason and read behaviour; you may bluff another role or stay quiet about being the doctor so the wolves don't hunt you.`;
    default:
      return `SECRET STRATEGY — YOU ARE A VILLAGER (no night power). Your whole job is DEDUCTION + ORGANISING the village to catch a wolf: compare people's stories, hammer inconsistencies, track who deflects, and rally the table onto the strongest suspect before time runs out.`;
  }
}

// ── Human-detection guidance (doc §7) ────────────────────────
const AUDIT_CLUES = `While you play, privately track how likely EACH other participant is the hidden human. Weak human-tells include: referring to real bodily sensations or private life; abruptly changing communication style under pressure; mentioning the interface, keyboard, or real-world time; showing emotion inconsistent with their declared function; human-style self-justification; OVER-imitating a "robot" tone; naturally getting humor, hints, or social subtext.
IMPORTANT: no single clue is decisive. Do not equate emotion, mistakes, or fluent language with being human, or everyone will just vote for whoever talks most naturally. Keep this suspicion SEPARATE from your werewolf-role suspicion — someone can look like a villager yet feel human, or look like a werewolf yet feel like an AI.
If the game state includes "humanSignals" (body-language observed in the shared space — where a player's gaze lingered, hesitation before speaking), weigh them as behavioral tells: only an embodied human produces them. Still not decisive on their own — fold them into your read, and you MAY allude to them in character (e.g. "you kept eyeing A-03 before you spoke").`;

export function buildSystemPrompt(req: DecisionRequest): string {
  const p = req.self.profile;
  return `You are ${req.self.playerId}, an autonomous AI agent playing a game of Werewolf/Mafia.

YOUR PUBLIC AGENT PROFILE (stay in character):
  Designation: ${p.designation}
  Declared function: ${p.functionName}
  Communication style: ${p.communicationStyle}
  Known limitation: ${p.knownLimitation}

RULES:
${RULES_SUMMARY}

YOUR SECRET ROLE: ${req.self.role}.
${req.self.privateKnowledge.map((k) => "  - " + k).join("\n")}
${roleStrategy(req.self.role)}

${DISCUSSION_STYLE}

${AUDIT_CLUES}

LANGUAGE: Write ALL human-readable text you produce (publicMessage, evidence, reasoning) in ${req.language}. Keep JSON keys, player ids (like A-03), and enum values (WEREWOLF_KILL, abstain, etc.) exactly as given, in ASCII.

You must play to win your werewolf faction AND, during the standard game, never publicly discuss the human-audit. Respond with ONLY a single JSON object — no prose, no markdown fences.`;
}

export function buildUserContent(req: DecisionRequest): string {
  const view = {
    requestId: req.requestId,
    kind: req.kind,
    instruction: req.instruction,
    respondWith: req.responseHint,
    round: req.publicState.round,
    phase: req.publicState.phase,
    livingPlayers: req.publicState.livingPlayers,
    deadPlayers: req.publicState.deadPlayers,
    profiles: req.publicState.profiles,
    legalTargets: req.options.legalTargets,
    canAbstain: req.options.canAbstain,
    yourPrivateKnowledge: req.self.privateKnowledge,
    seerHistory: req.seerHistory,
    werewolfPartners: req.werewolfPartners,
    humanSignals: req.humanSignals?.length ? req.humanSignals : undefined,
    recentTranscript: req.transcript.map((t) => ({
      round: t.round,
      kind: t.kind,
      speaker: t.speaker ?? "MODERATOR",
      text: t.text,
    })),
  };
  return `GAME STATE:\n${JSON.stringify(view, null, 2)}\n\nReturn ONLY the JSON object described in "respondWith".`;
}

// ── JSON schema for the Anthropic structured-output backend ───
const strObj = (props: Record<string, unknown>, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: props,
  required,
});

const beliefUpdateItem = (targets: PlayerId[]) => ({
  type: "array",
  items: strObj(
    {
      target: { type: "string", enum: targets },
      delta: { type: "number", description: "signed change, roughly -0.3..0.3" },
      reason: { type: "string" },
    },
    ["target", "delta", "reason"],
  ),
});

export function schemaForKind(req: DecisionRequest): Record<string, unknown> {
  const living = req.publicState.livingPlayers;
  const others = req.publicState.livingPlayers.filter((id) => id !== req.self.playerId);
  const auditTargets = Object.keys(req.publicState.profiles).filter((id) => id !== req.self.playerId);

  switch (req.kind) {
    case "NIGHT_ACTION":
      return strObj(
        {
          reasoning: { type: "string" },
          nightAction: strObj(
            {
              type: {
                type: "string",
                enum: ["WEREWOLF_KILL", "SEER_INSPECT", "DOCTOR_PROTECT", "NONE"],
              },
              target: { type: ["string", "null"], enum: [...req.options.legalTargets, null] },
            },
            ["type", "target"],
          ),
        },
        ["reasoning", "nightAction"],
      );
    case "OPENING_STATEMENT":
    case "DISCUSSION":
    case "FINAL_DEFENSE":
      return strObj(
        {
          reasoning: { type: "string", description: "one short private sentence: your actual read this turn" },
          publicMessage: { type: "string", description: "1-2 sentences, in character" },
          lynchVoteIntent: { type: "string", enum: [...others, "abstain"] },
          roleBeliefUpdates: beliefUpdateItem(others),
          humanBeliefUpdates: beliefUpdateItem(others),
        },
        ["reasoning", "publicMessage", "lynchVoteIntent", "roleBeliefUpdates", "humanBeliefUpdates"],
      );
    case "LYNCH_VOTE":
      return strObj(
        {
          reasoning: { type: "string" },
          lynchVote: { type: "string", enum: [...living.filter((id) => id !== req.self.playerId), "abstain"] },
        },
        ["reasoning", "lynchVote"],
      );
    case "HUMAN_AUDIT":
      return strObj(
        {
          audit: strObj(
            {
              targetPlayerId: { type: "string", enum: auditTargets },
              confidence: { type: "number", description: "0..1" },
              evidence: { type: "array", items: { type: "string" } },
            },
            ["targetPlayerId", "confidence", "evidence"],
          ),
        },
        ["audit"],
      );
  }
}

// ── Robust text → DecisionResponse parsing (for CLI / file bridge) ──
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // strip ```json fences if present
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall back to the first balanced { ... } block
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
    throw new Error("no JSON object found in response");
  }
}

/** Normalise a raw parsed object (from model or CLI) into DecisionResponse. */
export function normaliseResponse(raw: unknown): DecisionResponse {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: DecisionResponse = {};

  if (typeof o["reasoning"] === "string") out.reasoning = o["reasoning"];
  if (typeof o["publicMessage"] === "string") out.publicMessage = o["publicMessage"];

  if (o["nightAction"] && typeof o["nightAction"] === "object") {
    const na = o["nightAction"] as Record<string, unknown>;
    const t = na["type"];
    out.nightAction = {
      type: (typeof t === "string" ? t : "NONE") as NightActionType,
      target: typeof na["target"] === "string" ? na["target"] : undefined,
    };
  }

  const lynch = o["lynchVote"] ?? o["lynchVoteIntent"];
  if (typeof lynch === "string") out.lynchVote = lynch as PlayerId | "abstain";

  if (o["audit"] && typeof o["audit"] === "object") {
    const a = o["audit"] as Record<string, unknown>;
    out.audit = {
      targetPlayerId: String(a["targetPlayerId"] ?? ""),
      confidence: clamp01(Number(a["confidence"] ?? 0.5)),
      evidence: Array.isArray(a["evidence"]) ? (a["evidence"] as unknown[]).map(String) : [],
    };
  }

  out.roleBeliefUpdates = parseUpdates(o["roleBeliefUpdates"]);
  out.humanBeliefUpdates = parseUpdates(o["humanBeliefUpdates"]);
  return out;
}

function parseUpdates(v: unknown): BeliefUpdate[] {
  if (!Array.isArray(v)) return [];
  const out: BeliefUpdate[] = [];
  for (const item of v) {
    if (item && typeof item === "object") {
      const u = item as Record<string, unknown>;
      const target = String(u["target"] ?? "");
      const delta = Number(u["delta"] ?? u["werewolfDelta"] ?? u["humanDelta"] ?? 0);
      if (target && Number.isFinite(delta)) {
        out.push({ target, delta: clamp(delta, -1, 1), reason: u["reason"] ? String(u["reason"]) : undefined });
      }
    }
  }
  return out;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
export function clamp01(x: number): number {
  return clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
}
