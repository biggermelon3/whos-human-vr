import type {
  AuditBallot,
  GameState,
  NightAction,
  Phase,
  PlayerId,
  Role,
  SeerReading,
  TranscriptEntry,
  TranscriptKind,
} from "../domain/types.js";
import type { AgentProvider, DecisionRequest, DecisionResponse, PublicView, SelfView } from "../agents/provider.js";
import { playGuidance } from "../agents/prompts.js";
import { t, localizedProfile, llmLanguage, type Locale } from "../i18n/catalog.js";
import { makeRng, type Rng } from "../util/rng.js";
import { nextRequestId } from "../util/id.js";
import {
  computeResult,
  resolveLynch,
  resolveNight,
  seerReadingOf,
  standardOutcomeOrContinue,
  tallyVotes,
} from "../engine/engine.js";
import { validateAuditBallot, validateLynchVote, validateNightAction } from "../engine/validation.js";
import { buildSnapshot, revealAll, type GameEvent } from "./events.js";

export interface OrchestratorHooks {
  emit: (e: GameEvent) => void;
  log?: (record: Record<string, unknown>) => void;
}

const MAX_MSG = 400;

export class Orchestrator {
  private rng: Rng;
  private locale: Locale;
  private seerHistory: Array<{ round: number; target: PlayerId; reading: SeerReading }> = [];
  private humanNotes: string[] = [];
  private started = false;

  constructor(
    private state: GameState,
    private providers: Map<PlayerId, AgentProvider>,
    private hooks: OrchestratorHooks,
    // Optional source of behavioral observations about the embodied human (VR gaze,
    // hesitation). Fed to AI agents only; updated live via POST /api/observe.
    private getHumanSignals?: () => string[],
  ) {
    this.rng = makeRng(state.config.seed ^ 0x9e3779b9);
    this.locale = state.config.locale;
  }

  private tr(key: string, params?: Record<string, string | number>): string {
    return t(this.locale, key, params);
  }
  private roleWord(role: Role): string {
    return this.tr(`role.${role}`);
  }

  // ── public entry ───────────────────────────────────────────
  async run(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.setup();

    let standard = standardOutcomeOrContinue(this.state);
    for (let day = 1; day <= this.state.config.maxDays && !standard; day++) {
      this.state.round = day;
      await this.night();
      standard = standardOutcomeOrContinue(this.state);
      if (standard) break;
      await this.dayPhase();
      standard = standardOutcomeOrContinue(this.state);
    }

    const outcome = standard ?? "draw";
    if (outcome === "draw") this.moderator("system", this.tr("sys.draw_notice"));
    await this.audit(outcome);
  }

  // ── setup ──────────────────────────────────────────────────
  private setup(): void {
    const human = this.player(this.state.humanId);
    const prof = localizedProfile(human.id, this.locale);
    this.humanNotes.push(this.tr("note.only_human"));
    this.humanNotes.push(this.tr("note.imitate", { functionName: prof.functionName, style: prof.communicationStyle }));
    this.humanNotes.push(this.tr("note.your_role", { roleBrief: this.tr(`rolebrief.${human.role}`) }));
    if (human.role === "werewolf") {
      const partners = this.partnersOf(human.id);
      this.humanNotes.push(this.tr("note.partners", { list: partners.join(", ") || this.tr("note.none") }));
    }
    this.setPhase("setup");
    this.moderator("system", this.tr("sys.setup"));
    this.log({ event: "setup", seed: this.state.config.seed, humanId: this.state.humanId });
  }

  // ── night ──────────────────────────────────────────────────
  private async night(): Promise<void> {
    this.setPhase("night");
    this.state.night.kills = {};
    this.state.night.seerInspections = {};
    this.state.night.protectedTarget = undefined;
    this.state.night.resolvedDeath = undefined;
    this.moderator("system", this.tr("sys.night_header", { round: this.state.round }));

    const tasks: Array<Promise<void>> = [];
    const living = this.living();

    for (const ww of living.filter((p) => p.role === "werewolf")) {
      tasks.push(
        this.askNight(ww.id, "WEREWOLF_KILL", living.filter((p) => p.role !== "werewolf").map((p) => p.id)).then(
          (a) => {
            if (a.target) this.state.night.kills[ww.id] = a.target;
          },
        ),
      );
    }
    const seer = living.find((p) => p.role === "seer");
    if (seer) {
      tasks.push(
        this.askNight(seer.id, "SEER_INSPECT", living.filter((p) => p.id !== seer.id).map((p) => p.id)).then((a) => {
          if (a.target) {
            const reading = seerReadingOf(this.state, a.target);
            this.seerHistory.push({ round: this.state.round, target: a.target, reading });
            this.state.night.seerInspections[seer.id] = a.target;
            if (seer.id === this.state.humanId) {
              const note = this.tr("note.seer_result", {
                round: this.state.round,
                target: a.target,
                reading: this.tr(`reading.${reading}`),
              });
              this.humanNotes.push(note);
              this.hooks.emit({ type: "private", round: this.state.round, text: note });
            }
          }
        }),
      );
    }
    const doctor = living.find((p) => p.role === "doctor");
    if (doctor) {
      const legal = living.map((p) => p.id).filter((id) => id !== this.state.night.lastProtectedTarget);
      tasks.push(
        this.askNight(doctor.id, "DOCTOR_PROTECT", legal).then((a) => {
          if (a.target) this.state.night.protectedTarget = a.target;
        }),
      );
    }

    await Promise.all(tasks);

    const died = resolveNight(this.state, this.rng);
    this.setPhase("day_announce");
    if (died) {
      const p = this.player(died);
      this.say(undefined, "death", this.tr("sys.dawn_death", { id: died, role: this.roleWord(p.role) }));
      this.log({ event: "night_death", round: this.state.round, victim: died, role: p.role });
    } else {
      this.say(undefined, "death", this.tr("sys.dawn_safe"));
      this.log({ event: "night_no_death", round: this.state.round });
    }
    this.emitSnapshot();
  }

  // ── day ────────────────────────────────────────────────────
  private async dayPhase(): Promise<void> {
    await this.openingStatements();
    await this.discussion();
    await this.finalDefense();
    await this.lynchVote();
  }

  private async openingStatements(): Promise<void> {
    this.setPhase("day_opening");
    this.moderator("system", this.tr("sys.opening_header", { round: this.state.round }));
    this.state.day.preVotes = {};
    // Sequential: each surviving agent speaks in turn, revealed as they go.
    for (const p of this.living()) {
      const r = await this.speak(
        p.id,
        "OPENING_STATEMENT",
        this.tr("instr.opening"),
        `{ "publicMessage": string, "lynchVoteIntent": one of a living player or "abstain", "roleBeliefUpdates": [...], "humanBeliefUpdates": [...] }`,
        this.otherLiving(p.id),
      );
      this.applyBeliefs(p.id, r);
      this.emitThought(p.id, r);
      this.say(p.id, "opening", this.msg(r) ?? "…");
      this.state.day.preVotes[p.id] = this.legalVote(p.id, r.lynchVote, this.otherLiving(p.id));
    }
  }

  private async discussion(): Promise<void> {
    this.setPhase("day_discussion");
    this.moderator("system", this.tr("sys.discussion_header", { round: this.state.round }));
    const rounds = this.state.config.discussionRounds;
    for (let r = 0; r < rounds; r++) {
      let humanMsg: string | undefined;
      const humanAlive = this.player(this.state.humanId).alive;
      if (humanAlive) {
        const resp = await this.ask(
          this.state.humanId,
          "DISCUSSION",
          this.tr("instr.discussion", { n: r + 1, total: rounds }),
          `{ "publicMessage": string }`,
          this.otherLiving(this.state.humanId),
        );
        humanMsg = this.msg(resp);
        if (humanMsg) this.say(this.state.humanId, "discussion", humanMsg);
      }
      const responders = this.selectResponders(humanMsg);
      for (const id of responders) {
        const resp = await this.speak(
          id,
          "DISCUSSION",
          `Respond to the discussion so far: react to what a specific player just said, defend or press a suspect, or claim/vouch. One or two sentences, on-topic only.`,
          `{ "publicMessage": string, "lynchVoteIntent": ..., "roleBeliefUpdates": [...], "humanBeliefUpdates": [...] }`,
          this.otherLiving(id),
        );
        this.applyBeliefs(id, resp);
        this.emitThought(id, resp);
        const m = this.msg(resp);
        if (m) this.say(id, "discussion", m);
        const lean = resp.lynchVote ? this.legalVote(id, resp.lynchVote, this.otherLiving(id)) : undefined;
        if (lean) this.state.day.preVotes[id] = lean;
      }
    }
  }

  private async finalDefense(): Promise<void> {
    const { counts } = tallyVotes(this.state.day.preVotes);
    const defendants = counts.slice(0, 2).map(([id]) => id).filter((id) => this.player(id).alive);
    this.state.day.defendants = defendants;
    if (defendants.length === 0) return;
    this.setPhase("day_defense");
    this.moderator("system", this.tr("sys.defense_header", { round: this.state.round, list: defendants.join(", ") }));
    for (const id of defendants) {
      const resp = await this.speak(id, "FINAL_DEFENSE", this.tr("instr.defense"), `{ "publicMessage": string }`, this.otherLiving(id));
      this.say(id, "defense", this.msg(resp) ?? "…");
    }
  }

  private async lynchVote(): Promise<void> {
    this.setPhase("day_vote");
    this.moderator("system", this.tr("sys.vote_header", { round: this.state.round }));

    let eliminated = await this.runVoteRound(this.living().map((p) => p.id), undefined);
    if (eliminated && eliminated.tie) {
      const tied = eliminated.tied;
      this.moderator("system", this.tr("sys.tie", { list: tied.join(", ") }));
      for (const id of tied.filter((x) => this.player(x).alive)) {
        const resp = await this.speak(id, "FINAL_DEFENSE", this.tr("instr.defense_runoff"), `{ "publicMessage": string }`, this.otherLiving(id));
        this.say(id, "defense", this.msg(resp) ?? "…");
      }
      eliminated = await this.runVoteRound(this.living().map((p) => p.id), tied);
    }

    if (eliminated && !eliminated.tie && eliminated.target) {
      const victim = eliminated.target;
      resolveLynch(this.state, victim);
      const p = this.player(victim);
      this.say(undefined, "vote", this.tr("sys.eliminated", { id: victim, role: this.roleWord(p.role) }));
      this.log({ event: "lynch", round: this.state.round, target: victim, role: p.role });
    } else {
      this.say(undefined, "vote", this.tr("sys.no_elim"));
      this.log({ event: "no_lynch", round: this.state.round });
    }
    this.emitSnapshot();
  }

  private async runVoteRound(
    voters: PlayerId[],
    restrict: PlayerId[] | undefined,
  ): Promise<{ tie: boolean; tied: PlayerId[]; target?: PlayerId } | undefined> {
    const instruction = restrict
      ? this.tr("instr.vote_runoff", { list: restrict.join(", ") })
      : this.tr("instr.vote");
    // SIMULTANEOUS vote: everyone commits at the same time and nobody (incl. the
    // human) sees another's vote until all are in — then reveal them all together.
    const results = await Promise.all(
      voters.map(async (id) => {
        const legal = (restrict ?? this.otherLiving(id)).filter((x) => x !== id);
        const resp = await this.ask(id, "LYNCH_VOTE", instruction, `{ "lynchVote": one of the legal targets or "abstain" }`, legal);
        return { id, v: this.legalVote(id, resp.lynchVote, legal), resp };
      }),
    );
    const votes: Record<PlayerId, PlayerId | "abstain"> = {};
    for (const { id, v, resp } of results) {
      votes[id] = v;
      this.emitThought(id, resp);
    }
    for (const { id, v } of results) {
      const shown = v === "abstain" ? this.tr("abstain") : v;
      this.say(id, "vote", this.tr("vote.cast", { id, target: shown }));
    }
    const { leaders, top } = tallyVotes(votes);
    if (leaders.length === 0 || top === 0) return { tie: false, tied: [], target: undefined };
    if (leaders.length === 1) return { tie: false, tied: leaders, target: leaders[0] };
    return { tie: true, tied: leaders };
  }

  // ── audit ──────────────────────────────────────────────────
  private async audit(outcome: "village_win" | "werewolves_win" | "draw"): Promise<void> {
    this.setPhase("audit");
    this.moderator("system", this.tr("sys.audit_header", { outcome: this.tr(`outcome.${outcome}`) }));

    const aiAgents = this.state.players.filter((p) => p.meta === "ai");
    const ballotResults = await Promise.all(
      aiAgents.map((p) =>
        this.ask(
          p.id,
          "HUMAN_AUDIT",
          `The game is over. Independently and secretly name the ONE participant you believe was the human (not yourself). This is your only human-identity vote.`,
          `{ "audit": { "targetPlayerId": one participant, "confidence": 0..1, "evidence": [short strings] } }`,
          this.allExcept(p.id),
        ).then((resp) => ({ id: p.id, resp })),
      ),
    );

    const ballots: AuditBallot[] = ballotResults.map(({ id, resp }) => this.coerceAudit(id, resp));
    const result = computeResult(this.state, outcome, ballots);
    this.state.result = result;

    // The ballots are shown all at once by the client (from the result event); the
    // moderator only announces the tally + who won — no per-ballot narration.
    this.moderator("result", this.tr("audit.tally", {
      humanId: this.state.humanId,
      votes: result.votesAgainstHuman,
      threshold: result.detectionThreshold,
      verdict: result.humanDetected ? this.tr("verdict.detected") : this.tr("verdict.hidden"),
    }));
    this.moderator("result", this.tr("audit.final", {
      final: this.tr(`final.${result.finalOutcome}`),
      score: result.score,
    }));

    this.setPhase("game_over");
    this.log({ event: "result", ...result });
    this.hooks.emit({ type: "result", result, reveal: revealAll(this.state.players, this.state.humanId, this.locale) });
    this.emitSnapshot(true);
  }

  // ── decision plumbing ──────────────────────────────────────
  private async askNight(id: PlayerId, wanted: NightAction["type"], legalTargets: PlayerId[]): Promise<NightAction> {
    const p = this.player(id);
    const resp = await this.ask(
      id,
      "NIGHT_ACTION",
      this.tr("instr.night", { round: this.state.round, action: this.tr(`action.${wanted}`) }),
      `{ "nightAction": { "type": "${wanted}", "target": one of legalTargets } }`,
      legalTargets,
    );
    return this.coerceNight(id, p.role, wanted, resp, legalTargets);
  }

  /** Emit a "whose turn" cue (for non-human speakers), then ask them. */
  private async speak(
    id: PlayerId,
    kind: DecisionRequest["kind"],
    instruction: string,
    responseHint: string,
    legalTargets: PlayerId[],
  ): Promise<DecisionResponse> {
    if (id !== this.state.humanId) this.hooks.emit({ type: "turn", speaker: id, kind });
    return this.ask(id, kind, instruction, responseHint, legalTargets);
  }

  private async ask(
    id: PlayerId,
    kind: DecisionRequest["kind"],
    instruction: string,
    responseHint: string,
    legalTargets: PlayerId[],
  ): Promise<DecisionResponse> {
    const req: DecisionRequest = {
      requestId: nextRequestId(),
      kind,
      instruction,
      responseHint,
      locale: this.locale,
      language: llmLanguage(this.locale),
      self: this.selfView(id),
      guidance: playGuidance(this.player(id).role),
      publicState: this.publicView(),
      transcript: this.state.transcript.slice(-40),
      options: { livingPlayers: this.living().map((p) => p.id), legalTargets, canAbstain: kind === "LYNCH_VOTE" },
      seerHistory: this.player(id).role === "seer" ? this.seerHistory : undefined,
      werewolfPartners: this.player(id).role === "werewolf" ? this.partnersOf(id) : undefined,
      // Only AI agents get the human's body-language tells (the human never sees them).
      humanSignals: id !== this.state.humanId ? this.getHumanSignals?.() : undefined,
    };
    const provider = this.providers.get(id);
    if (!provider) return {};
    const isHuman = id === this.state.humanId;
    if (isHuman) this.hooks.emit({ type: "awaiting_input", request: req });
    let resp: DecisionResponse = {};
    try {
      resp = await provider.decide(req);
    } catch (err) {
      console.error(`[orchestrator] ${id} ${kind} error:`, (err as Error).message);
    }
    if (isHuman) this.hooks.emit({ type: "input_cleared" });
    return resp;
  }

  // ── coercion (moderator enforces legal moves) ──────────────
  private coerceNight(
    id: PlayerId,
    role: Role,
    wanted: NightAction["type"],
    resp: DecisionResponse,
    legalTargets: PlayerId[],
  ): NightAction {
    const target = resp.nightAction?.target;
    const candidate: NightAction = { type: wanted, actor: id, target };
    if (target && validateNightAction(this.state, candidate).ok) return candidate;
    // fallback: pick a random legal target
    if (legalTargets.length === 0) return { type: "NONE", actor: id };
    return { type: wanted, actor: id, target: this.rng.pick(legalTargets) };
  }

  private legalVote(id: PlayerId, vote: PlayerId | "abstain" | undefined, legalTargets: PlayerId[]): PlayerId | "abstain" {
    if (vote === "abstain") return "abstain";
    if (vote && legalTargets.includes(vote) && validateLynchVote(this.state, id, vote).ok) return vote;
    if (legalTargets.length === 0) return "abstain";
    return this.rng.pick(legalTargets);
  }

  private coerceAudit(id: PlayerId, resp: DecisionResponse): AuditBallot {
    const targets = this.allExcept(id);
    let target = resp.audit?.targetPlayerId;
    if (!target || !validateAuditBallot(this.state, id, target).ok) target = this.rng.pick(targets);
    return {
      voter: id,
      targetPlayerId: target,
      confidence: clamp01(resp.audit?.confidence ?? 0.5),
      evidence: (resp.audit?.evidence ?? []).slice(0, 3),
    };
  }

  // ── belief bookkeeping ─────────────────────────────────────
  private applyBeliefs(id: PlayerId, resp: DecisionResponse): void {
    const mind = this.state.minds[id];
    if (!mind) return;
    for (const u of resp.roleBeliefUpdates ?? []) {
      const rb = mind.roleBeliefs[u.target];
      if (rb) rb.werewolfProbability = clamp01(rb.werewolfProbability + u.delta);
    }
    for (const u of resp.humanBeliefUpdates ?? []) {
      const hb = mind.humanBeliefs[u.target];
      if (hb) {
        hb.humanProbability = clamp01(hb.humanProbability + u.delta);
        if (u.reason) hb.evidence.push(u.reason);
      }
    }
  }

  /** Surface an AI agent's private read + its two suspicion tracks (observer mode). */
  private emitThought(id: PlayerId, resp: DecisionResponse): void {
    const mind = this.state.minds[id];
    if (!mind) return; // AI only; the human has no mind
    this.hooks.emit({
      type: "thought",
      speaker: id,
      round: this.state.round,
      reasoning: resp.reasoning ?? "",
      wolf: topBelief(mind.roleBeliefs, "werewolfProbability"),
      human: topBelief(mind.humanBeliefs, "humanProbability"),
    });
  }

  // ── views ──────────────────────────────────────────────────
  private selfView(id: PlayerId): SelfView {
    const p = this.player(id);
    const notes: string[] = [`You are ${id}, an ${p.meta} participant. Your werewolf role: ${p.role}.`];
    if (p.role === "werewolf") notes.push(`Werewolf partner(s): ${this.partnersOf(id).join(", ") || "(none)"}.`);
    if (p.role === "seer") for (const h of this.seerHistory) notes.push(`Night ${h.round}: ${h.target} is ${h.reading.replace(/_/g, " ")}.`);
    const mind = this.state.minds[id];
    return {
      playerId: id,
      role: p.role,
      meta: p.meta,
      profile: localizedProfile(id, this.locale),
      alive: p.alive,
      privateKnowledge: notes,
      roleBeliefs: mind?.roleBeliefs,
      humanBeliefs: mind?.humanBeliefs,
    };
  }

  private publicView(): PublicView {
    const profiles: PublicView["profiles"] = {};
    for (const p of this.state.players) profiles[p.id] = localizedProfile(p.id, this.locale);
    return {
      round: this.state.round,
      phase: this.state.phase,
      livingPlayers: this.living().map((p) => p.id),
      deadPlayers: this.state.players
        .filter((p) => !p.alive)
        .map((p) => ({ id: p.id, role: p.role, cause: p.eliminatedCause ?? "unknown", round: p.eliminatedRound ?? 0 })),
      profiles,
    };
  }

  private selectResponders(humanMsg: string | undefined): PlayerId[] {
    const livingAi = this.living().filter((p) => p.meta === "ai");
    const chosen: PlayerId[] = [];
    if (humanMsg) {
      for (const m of humanMsg.matchAll(/A-0\d/g)) {
        const id = m[0];
        if (livingAi.some((p) => p.id === id) && !chosen.includes(id)) chosen.push(id);
      }
    }
    // fill with the currently most-suspected living AI agents
    const suspicion = (id: PlayerId): number => {
      let s = 0;
      for (const m of Object.values(this.state.minds)) s += m.roleBeliefs[id]?.werewolfProbability ?? 0;
      return s;
    };
    // EVERY living AI speaks each round (mentioned players first, then most-suspected),
    // so nobody sits silent.
    const ranked = [...livingAi].sort((a, b) => suspicion(b.id) - suspicion(a.id));
    for (const p of ranked) if (!chosen.includes(p.id)) chosen.push(p.id);
    return chosen;
  }

  // ── small helpers ──────────────────────────────────────────
  private player(id: PlayerId) {
    return this.state.players.find((p) => p.id === id)!;
  }
  private living() {
    return this.state.players.filter((p) => p.alive);
  }
  private otherLiving(id: PlayerId): PlayerId[] {
    return this.living().map((p) => p.id).filter((x) => x !== id);
  }
  private allExcept(id: PlayerId): PlayerId[] {
    return this.state.players.map((p) => p.id).filter((x) => x !== id);
  }
  private partnersOf(id: PlayerId): PlayerId[] {
    return this.state.players.filter((p) => p.role === "werewolf" && p.id !== id).map((p) => p.id);
  }
  private msg(resp: DecisionResponse): string | undefined {
    if (!resp.publicMessage) return undefined;
    return resp.publicMessage.slice(0, MAX_MSG).trim();
  }

  private setPhase(phase: Phase): void {
    this.state.phase = phase;
    this.emitSnapshot();
  }
  private moderator(kind: TranscriptKind, text: string): void {
    this.say(undefined, kind, text);
  }
  private say(speaker: PlayerId | undefined, kind: TranscriptKind, text: string): void {
    const entry: TranscriptEntry = { round: this.state.round, phase: this.state.phase, kind, speaker, text };
    this.state.transcript.push(entry);
    this.hooks.emit({ type: "transcript", entry });
  }
  private emitSnapshot(reveal = false): void {
    const snap = buildSnapshot(this.state, reveal, this.locale);
    snap.you.privateNotes = [...this.humanNotes];
    this.hooks.emit({ type: "snapshot", snapshot: snap });
  }
  private log(record: Record<string, unknown>): void {
    this.hooks.log?.(record);
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0.5));
}

function topBelief(map: Record<string, any>, field: string): { id: string; p: number } | null {
  let best: { id: string; p: number } | null = null;
  for (const id of Object.keys(map)) {
    const p = Number(map[id]?.[field] ?? 0);
    if (best === null || p > best.p) best = { id, p: Math.round(p * 100) / 100 };
  }
  return best;
}
