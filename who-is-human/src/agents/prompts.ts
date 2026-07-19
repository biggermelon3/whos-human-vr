import type { BeliefUpdate, DecisionRequest, DecisionResponse } from "./provider.js";
import { RULES_SUMMARY } from "../domain/profiles.js";
import type { NightActionType, PlayerId, Role } from "../domain/types.js";

// ── How to actually PLAY — this IS the game ───────────────────
const DISCUSSION_STYLE = `HOW TO PLAY (spend EVERY sentence on the werewolf game — nothing else):
  • GROUND everything in the GAME STATE you are given: who is ALIVE, and who DIED last night. NEVER contradict it — if a player was killed last night, do not say the night was quiet or that "no one died".
  • REACT to what specific players JUST said this round. Quote or paraphrase them and agree, back them, or tear it apart. Never speak into a vacuum, and never narrate your own personality or "function".
  • Take a POSITION: name a prime suspect with a concrete reason (their vote, their claim, their silence), and revise it as new info lands.
  • Use the social tactics for your role (below): claim/counter-claim a power role, vouch a player as clearly good, pile suspicion onto one target, defend, form and break alliances.
  • Write ONLY in the requested language (ASCII if English) — do not sprinkle in foreign-language jargon.
  • Coordinate the vote: "We only need ONE wolf — lock down A-03's story," or rally people onto a suspect.
  • 1–2 sharp sentences, addressing players by id (A-03). Talk like a sharp human player, not like a chatbot describing itself.`;

/** Role strategy + how-to-play, shared by the api prompt AND attached to every request
 * (req.guidance) so the file/CLI backend's agents read the same strategy. */
export function playGuidance(role: Role): string {
  return roleStrategy(role) + "\n\n" + DISCUSSION_STYLE;
}

function roleStrategy(role: Role): string {
  switch (role) {
    case "werewolf":
      return `SECRET STRATEGY — YOU ARE A WEREWOLF. Never admit or hint it; talk, reason and vote like a villager who is hunting wolves. Weaponise the social game against the village:
  • FRAME / fake-claim: you may falsely claim a power role (e.g. "I'm the seer, and A-04 reads wolf to me") or pin a fake role on someone to get them lynched or to steal the village's trust. If the real SEER reveals, COUNTER-CLAIM seer and out-argue them with a cleaner, more confident story.
  • PILE ON: pick a believable target — a villager, or better the real seer/doctor — and push hard, then steer votes onto them.
  • FAKE-VOUCH: publicly declare a player "clearly good", or loudly back someone's read, to build your own credibility, quietly SHIELD your werewolf partner, or set up a later betrayal.
  • Cover your partner: never vote them, softly deflect heat off them — but do not defend them so hard it looks obvious. Your top prize is getting the SEER (then the doctor) killed or lynched.`;
    case "seer":
      return `SECRET STRATEGY — YOU ARE THE SEER — the village's strongest weapon, and the wolves' #1 target the moment you reveal.
  • You have REAL alignment reads from your night inspections. Drip hints or hold them, and hard-claim seer + call your read (this player is a wolf / this player is clean) only when it will actually swing the vote.
  • Expect a wolf to COUNTER-CLAIM seer against you — win the room by being the more specific and consistent read, and by pointing at who benefits from muddying it.`;
    case "doctor":
      return `SECRET STRATEGY — YOU ARE THE DOCTOR. You protect one player each night — use it to keep the likely SEER alive. Help the village reason; you MAY bluff a role (even fake-claim seer) to pull the wolves' attention off the real seer.`;
    default:
      return `SECRET STRATEGY — YOU ARE A VILLAGER (no night power). Find the wolves AND protect the village's power roles:
  • Signal you're village-aligned through pro-village reasoning and genuinely hunting wolves — but you CAN'T prove it, so don't over-claim; earn trust by being useful and consistent.
  • If a credible SEER emerges, BACK them and help defend their identity so the wolves can't pick them off; and when two players both claim seer, work out which one is the wolf.
  • Track who deflects, who fake-vouches, who piles on with no evidence — that's your wolf.`;
  }
}

// ── Human-detection guidance (doc §7) ────────────────────────
const AUDIT_CLUES = `While you play, privately track how likely EACH other participant is the hidden human. Weak human-tells include: referring to real bodily sensations or private life; mentioning the interface, keyboard, or real-world time; unusually emotional or spontaneous phrasing; human-style self-justification; OVER-imitating a "robot" tone; naturally getting humor, hints, or social subtext.
IMPORTANT: no single clue is decisive. Do not equate emotion, mistakes, or fluent language with being human, or everyone will just vote for whoever talks most naturally. Keep this suspicion SEPARATE from your werewolf-role suspicion — someone can look like a villager yet feel human, or look like a werewolf yet feel like an AI.
If the game state includes "humanSignals" (body-language observed in the shared space — where a player's gaze lingered, hesitation before speaking), weigh them as behavioral tells: only an embodied human produces them. Still not decisive on their own — fold them into your read, and you MAY call them out in the discussion (e.g. "you kept eyeing A-03 before you spoke").`;

export function buildSystemPrompt(req: DecisionRequest): string {
  return `You are ${req.self.playerId} in a game of social-deduction Werewolf. Your ONLY objective is to WIN — play like a sharp human werewolf player.

YOUR SECRET ROLE: ${req.self.role}.
${req.self.privateKnowledge.map((k) => "  - " + k).join("\n")}
${playGuidance(req.self.role)}

RULES:
${RULES_SUMMARY}

STAY STRICTLY ON TOPIC: Talk ONLY about the werewolf game — suspects, role claims, who is a wolf, who to vote for, and the reasons. You have NO persona, "type", "function" or job description — never invent, describe, or reference one. No small talk, no meta, no "as a … agent". Every single line is a suspect, a claim, a vote, or a read.

${AUDIT_CLUES}

LANGUAGE: Write EVERYTHING in ${req.language} ONLY, as plain natural Werewolf table-talk, with NO words or jargon from any other language (for English, stay pure ASCII). Keep JSON keys, player ids (A-03), and enum values (WEREWOLF_KILL, abstain, etc.) exactly as given.

Play to win your werewolf faction; never publicly discuss the human-audit during the standard game. Respond with ONLY a single JSON object — no prose, no markdown fences.`;
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
  const dead = req.publicState.deadPlayers;
  const deathNote = dead.length
    ? `Eliminated so far: ${dead.map((d) => `${d.id} (${d.role}, ${d.cause}, round ${d.round})`).join("; ")}.`
    : "No one has been eliminated yet.";
  const situation =
    `SITUATION — Round ${req.publicState.round}, phase ${req.publicState.phase}. ` +
    `Alive: ${req.publicState.livingPlayers.join(", ")}. ${deathNote} ` +
    `Base every claim on THIS — do not contradict who is alive or dead.`;
  return `${situation}\n\nGAME STATE:\n${JSON.stringify(view, null, 2)}\n\nReturn ONLY the JSON object described in "respondWith".`;
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
          publicMessage: { type: "string", description: "1-2 sentences of on-topic Werewolf table-talk (suspects/claims/votes)" },
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
