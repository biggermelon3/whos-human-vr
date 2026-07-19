// Who is Human — browser client. Consumes the SSE game stream and renders the
// terminal, the sidebar, and the human input forms.

const $ = (id) => document.getElementById(id);
const transcriptEl = $("transcript");
const statusEl = $("status");
const playersEl = $("players");
const youBodyEl = $("youBody");
const privateNotesEl = $("privateNotes");
const inputBar = $("inputBar");
const inputPrompt = $("inputPrompt");
const inputControls = $("inputControls");
const waitingEl = $("waiting");

const I18N = window.WIH_I18N;
const T = (k, p) => I18N.T(k, p);

let game = { humanId: null, seed: null, backend: null };
let snapshot = null;
let gameLocale = null; // language the CURRENT game's agents speak (fixed per game)
const localeNames = {}; // code -> native name, for the apply button label
let observer = localStorage.getItem("wih_observer") === "1"; // reveal agent reasoning

const ROLE_TO_NIGHT = { werewolf: "WEREWOLF_KILL", seer: "SEER_INSPECT", doctor: "DOCTOR_PROTECT" };

function connect() {
  const es = new EventSource("/api/events");
  es.onopen = () => (statusEl.textContent = T("status.connected"));
  es.onerror = () => (statusEl.textContent = T("status.reconnecting"));
  es.onmessage = (m) => {
    let e;
    try { e = JSON.parse(m.data); } catch { return; }
    dispatch(e);
  };
}

function dispatch(e) {
  switch (e.type) {
    case "game_start": return onGameStart(e);
    case "turn": return onTurn(e);
    case "thought": return onThought(e);
    case "transcript": return addLine(e.entry);
    case "private": return addPrivate(e.text);
    case "snapshot": return onSnapshot(e.snapshot);
    case "awaiting_input": return showInput(e.request);
    case "input_cleared": return hideInput();
    case "result": return showResult(e.result, e.reveal);
    case "error": return toast(e.text);
  }
}

function onGameStart(e) {
  game = { humanId: e.humanId, seed: e.seed, backend: e.backend };
  gameLocale = e.locale || "en"; // the language THIS game's agents speak
  transcriptEl.innerHTML = "";
  privateNotesEl.innerHTML = "";
  playersEl.innerHTML = "";
  if (window.WIH_TTS) {
    window.WIH_TTS.reset(); // clear voices/cache for the new game
    window.WIH_TTS.setLocale(gameLocale); // voices follow the language actually spoken
  }
  $("resultOverlay").classList.add("hidden");
  hideInput();
  updateApplyBtn(); // show "apply" if the UI language differs from the agents'
  statusEl.textContent = T("status.newgame", { seed: e.seed, backend: e.backend });
}

// Show the "apply to agents" button only when the UI language differs from the
// language the current game's agents are speaking.
function updateApplyBtn() {
  const btn = $("applyLang");
  if (!btn) return;
  const mismatch = gameLocale && gameLocale !== I18N.locale;
  btn.classList.toggle("hidden", !mismatch);
  const name = localeNames[I18N.locale] || I18N.locale;
  btn.textContent = T("lang.apply");
  btn.title = `Restart so the agents and voices speak ${name}`;
}

// Show whose turn it is while that agent is deciding.
function onTurn(e) {
  waitingEl.textContent = T("waiting.speaking", { id: e.speaker });
  waitingEl.classList.remove("hidden");
}

// Observer mode: reveal an AI agent's private read + its two suspicion tracks.
function onThought(e) {
  if (!observer) return;
  const div = document.createElement("div");
  div.className = "line thought";
  const parts = [`💭 ${e.speaker}`];
  if (e.reasoning) parts.push(escapeHtml(e.reasoning));
  const tracks = [];
  if (e.wolf) tracks.push(`${T("thought.wolf")} ${e.wolf.id} ${Math.round(e.wolf.p * 100)}%`);
  if (e.human) tracks.push(`${T("thought.human")} ${e.human.id} ${Math.round(e.human.p * 100)}%`);
  let html = parts.join(": ");
  if (tracks.length) html += `  <span class="tracks">[${tracks.join(" · ")}]</span>`;
  div.innerHTML = html;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ── transcript ───────────────────────────────────────────────
function addLine(entry) {
  const div = document.createElement("div");
  const isYou = entry.speaker && entry.speaker === game.humanId;
  const kindClass = entry.speaker ? entry.kind : "moderator";
  div.className = `line ${kindClass}${isYou ? " you" : ""}`;
  const who = entry.speaker ? `${entry.speaker}${isYou ? " (you)" : ""}` : "MODERATOR";
  div.innerHTML = `<span class="who">${who}:</span> ${escapeHtml(entry.text)}`;
  transcriptEl.appendChild(div);
  // Attach a voice play button (no-op if the TTS client isn't loaded).
  if (window.WIH_TTS) window.WIH_TTS.decorate(div, entry.speaker || "", entry.text);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function addPrivate(text) {
  const li = document.createElement("li");
  li.textContent = text;
  privateNotesEl.appendChild(li);
}

// ── snapshot / sidebar ───────────────────────────────────────
function onSnapshot(snap) {
  snapshot = snap;
  statusEl.textContent = T("status.line", {
    round: snap.round,
    phase: T("phase." + snap.phase),
    id: snap.you.id,
    backend: game.backend ?? "?",
    seed: game.seed ?? "?",
  });

  // you card
  const roleLabel = snap.you.roleLabel || snap.you.role;
  youBodyEl.innerHTML =
    `<div><span class="pid">${snap.you.id}</span> — ${T("you.cover")}: <b>${escapeHtml(snap.you.functionName)}</b></div>` +
    `<div>${T("you.secretrole")}: <span class="role">${escapeHtml(roleLabel).toUpperCase()}</span> ${snap.you.alive ? "" : T("you.eliminated")}</div>` +
    `<div class="muted">${T("you.style")}: ${escapeHtml(snap.you.communicationStyle)}</div>` +
    `<div class="muted">${T("you.limitation")}: ${escapeHtml(snap.you.knownLimitation)}</div>`;

  // players
  if (window.WIH_TTS) window.WIH_TTS.setRoster(snap.players.map((p) => p.id));
  playersEl.innerHTML = "";
  for (const p of snap.players) {
    const li = document.createElement("li");
    li.className = `${p.isYou ? "you" : ""} ${p.alive ? "" : "dead"}`;
    const roleTxt = p.revealedRoleLabel
      ? `<span class="role">${escapeHtml(p.revealedRoleLabel)}</span>`
      : `<span class="tag">AI?</span>`;
    li.innerHTML = `<span class="pid">${p.id}${p.isYou ? " ★" : ""}</span><span class="role">${p.alive ? escapeHtml(p.functionName) : roleTxt}</span>`;
    playersEl.appendChild(li);
  }

  // private notes (authoritative from snapshot)
  if (Array.isArray(snap.you.privateNotes) && snap.you.privateNotes.length) {
    privateNotesEl.innerHTML = "";
    for (const n of snap.you.privateNotes) addPrivate(n);
  }
}

// ── human input ──────────────────────────────────────────────
function showInput(req) {
  waitingEl.classList.add("hidden");
  inputBar.classList.remove("hidden");
  inputPrompt.textContent = req.instruction;
  inputControls.innerHTML = "";

  const legal = req.options.legalTargets || [];
  const send = (response) => submit(req.requestId, response);

  if (req.kind === "NIGHT_ACTION") {
    const type = ROLE_TO_NIGHT[req.self.role] || "NONE";
    const sel = targetSelect(legal, false);
    const btn = button(T("input.confirm"), () => send({ nightAction: { type, target: sel.value } }));
    inputControls.append(sel, btn);
  } else if (req.kind === "LYNCH_VOTE") {
    const sel = targetSelect(legal, req.options.canAbstain);
    const btn = button(T("input.vote"), () => send({ lynchVote: sel.value }));
    inputControls.append(sel, btn);
  } else {
    // OPENING_STATEMENT / DISCUSSION / FINAL_DEFENSE
    const ta = document.createElement("textarea");
    ta.placeholder = T("input.placeholder");
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) doSend();
    });
    inputControls.appendChild(ta);

    let leanSel = null;
    if (req.kind === "OPENING_STATEMENT") {
      leanSel = targetSelect(legal, true);
      leanSel.title = T("input.lean");
      inputControls.appendChild(labelWrap(T("input.lean"), leanSel));
    }
    const doSend = () => {
      const response = { publicMessage: ta.value.trim() };
      if (leanSel) response.lynchVoteIntent = leanSel.value;
      send(response);
    };
    inputControls.appendChild(button(T("input.send"), doSend));
    ta.focus();
  }
}

function hideInput() {
  inputBar.classList.add("hidden");
  inputControls.innerHTML = "";
  if (!snapshot || !snapshot.gameOver) waitingEl.classList.remove("hidden");
}

async function submit(requestId, response) {
  inputBar.classList.add("hidden");
  waitingEl.classList.remove("hidden");
  try {
    await fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, response }),
    });
  } catch (err) {
    toast("failed to send input");
  }
}

// ── result ───────────────────────────────────────────────────
function showResult(result, reveal) {
  waitingEl.classList.add("hidden");
  const titleEl = $("resultTitle");
  const bodyEl = $("resultBody");
  const cls = result.score === 2 ? "win" : result.score === 1 ? "mid" : "lose";
  titleEl.textContent = T("final." + result.finalOutcome);
  titleEl.className = cls;

  const rows = reveal
    .map((p) => {
      const you = p.isYou ? " ★" + T("result.you_tag") : "";
      const human = p.isYou ? " · " + T("result.human_tag") : "";
      return `${p.id}${you}: ${escapeHtml(p.revealedRoleLabel || p.revealedRole)}${human}`;
    })
    .join("<br>");

  const standard = T("outcome." + result.standardOutcome);
  const faction = result.humanFactionWon
    ? `<span class='win'>${T("result.faction_won")}</span>`
    : `<span class='lose'>${T("result.faction_lost")}</span>`;
  const verdict = result.humanDetected
    ? `<span class='lose'>${T("result.detected")}</span>`
    : `<span class='win'>${T("result.undetected")}</span>`;

  bodyEl.innerHTML =
    `<p class="big">${T("result.standard")} <b>${standard}</b> — ${faction}</p>` +
    `<p class="big">${T("result.audit", { votes: result.votesAgainstHuman, threshold: result.detectionThreshold })} ${T("result.you_were")} ${verdict}.</p>` +
    `<p>${T("result.score", { score: result.score })}</p><hr style="border-color:#232b3a" /><p class="muted">${rows}</p>`;
  $("resultOverlay").classList.remove("hidden");
}

// ── helpers ──────────────────────────────────────────────────
function targetSelect(targets, allowAbstain) {
  const sel = document.createElement("select");
  for (const t of targets) sel.appendChild(option(t, t));
  if (allowAbstain) sel.appendChild(option("abstain", T("abstain")));
  return sel;
}
function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}
function button(label, onClick, primary = true) {
  const b = document.createElement("button");
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}
function labelWrap(text, el) {
  const span = document.createElement("span");
  span.className = "muted";
  span.style.display = "inline-flex";
  span.style.gap = "4px";
  span.style.alignItems = "center";
  span.append(text, el);
  return span;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(text) {
  statusEl.textContent = text;
}

// ── controls ─────────────────────────────────────────────────
$("newGameBtn").addEventListener("click", newGame);
$("resultNew").addEventListener("click", newGame);
$("applyLang").addEventListener("click", newGame); // restart in the selected UI language
async function newGame() {
  const backend = $("backendSel").value || undefined;
  const seedRaw = $("seedInput").value;
  const seed = seedRaw ? Number(seedRaw) : undefined;
  await fetch("/api/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend, seed, locale: I18N.locale }),
  });
}

function bootstrap() {
  // Connect to the game stream FIRST — never block it on translations loading.
  connect();

  // Voice output (optional): wire the auto-voice toggle and probe the service.
  if (window.WIH_TTS) {
    const auto = $("ttsAuto");
    if (auto) auto.addEventListener("change", () => window.WIH_TTS.setAutoplay(auto.checked));
    window.WIH_TTS.init();
  }

  // Observer mode toggle (reveal agent reasoning).
  const obs = $("observer");
  if (obs) {
    obs.checked = observer;
    obs.addEventListener("change", () => {
      observer = obs.checked;
      localStorage.setItem("wih_observer", observer ? "1" : "0");
    });
  }

  // Load translations + language selector in the background.
  I18N.ready.then(async () => {
    I18N.applyStatic();
    try {
      const res = await fetch("/api/locales");
      const { locales } = await res.json();
      const sel = $("langSel");
      sel.innerHTML = "";
      for (const l of locales) {
        localeNames[l.code] = l.native;
        const o = document.createElement("option");
        o.value = l.code;
        o.textContent = l.native;
        sel.appendChild(o);
      }
      sel.value = I18N.locale;
      // Changing the language switches the UI immediately (live). The agents
      // keep speaking their language until you click "apply" or "New game".
      sel.addEventListener("change", () => {
        I18N.setLocale(sel.value);
        I18N.applyStatic();
        if (snapshot) onSnapshot(snapshot); // re-render dynamic UI in the new language
        updateApplyBtn();
      });
      updateApplyBtn();
    } catch {
      /* selector stays empty; default locale still works */
    }
  });
}

bootstrap();
