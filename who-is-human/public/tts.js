// Who is Human — TTS voice client.
//
// Talks to the local kokoro-local-tts service (default http://127.0.0.1:8000)
// to turn each transcript line into speech. Each participant (A-01..A-07) gets a
// distinct, stable voice; the moderator gets its own. Language is auto-detected
// per line (Chinese vs English) so a game played in either locale is voiced
// correctly. Generated audio is cached both server-side (SHA-256 WAV cache) and
// here (per line), so replays are instant.
//
// Wrapped in an IIFE; only window.WIH_TTS leaks. Fails gracefully: if the voice
// service is not running the buttons still render and simply report the error
// on click — the game itself is never affected.
(function () {
  const BASE = (localStorage.getItem("wih_tts_base") || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const MAX_CHARS = 500; // kokoro accepts 1..500 characters

  // Detects Han (Chinese) chars -> Mandarin voice; otherwise English.
  const CJK = /[㐀-鿿豈-﫿]/;

  // Voice pools (must exist in the kokoro catalog). Players are assigned a
  // distinct voice in id order; the moderator uses a reserved voice.
  const EN_MODERATOR = "bm_george";
  const EN_PLAYER_POOL = [
    "af_heart", "am_michael", "bf_emma", "am_fenrir",
    "af_bella", "am_puck", "af_nicole", "bm_fable",
  ];
  const ZH_MODERATOR = "zf_xiaoxiao";
  const ZH_PLAYER_POOL = ["zm_yunxi", "zf_xiaoxiao"];
  // Extra Kokoro language pools (voice names ship with Kokoro-82M; your kokoro
  // service must accept the matching `language` codes below).
  const ES_POOL = ["ef_dora", "em_alex", "em_santa"];
  const FR_POOL = ["ff_siwis"];
  const HI_POOL = ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"];
  const VOICE_LANG = {
    af_heart: "en-US", af_bella: "en-US", af_nicole: "en-US",
    am_michael: "en-US", am_fenrir: "en-US", am_puck: "en-US",
    bf_emma: "en-GB", bm_george: "en-GB", bm_fable: "en-GB",
    zf_xiaoxiao: "zh-CN", zm_yunxi: "zh-CN",
    ef_dora: "es", em_alex: "es", em_santa: "es",
    ff_siwis: "fr-fr",
    hf_alpha: "hi", hf_beta: "hi", hm_omega: "hi", hm_psi: "hi",
  };
  // Which voice pool to use per game locale. Locales with no Kokoro voices
  // (e.g. ko) fall back to English — the text is spoken, just with an EN accent.
  const LOCALE_POOL = {
    en: { mod: EN_MODERATOR, pool: EN_PLAYER_POOL },
    zh: { mod: ZH_MODERATOR, pool: ZH_PLAYER_POOL },
    es: { mod: "em_santa", pool: ES_POOL },
    fr: { mod: "ff_siwis", pool: FR_POOL },
    hi: { mod: "hm_omega", pool: HI_POOL },
  };

  let gameLocale = "en"; // language the current game is played in
  let autoplay = false;
  let available = false;
  const cache = new Map(); // cacheKey -> { url, audio }
  const rosterIndex = new Map(); // playerId -> stable index
  let currentAudio = null;
  let currentBtn = null;
  let queue = Promise.resolve(); // sequential auto-play chain

  // ── voice selection ────────────────────────────────────────
  function speakerIndex(id) {
    if (!rosterIndex.has(id)) rosterIndex.set(id, rosterIndex.size);
    return rosterIndex.get(id);
  }
  function setRoster(ids) {
    // Assign stable indices in sorted id order (A-01..A-07) once per game.
    for (const id of [...ids].sort()) if (!rosterIndex.has(id)) rosterIndex.set(id, rosterIndex.size);
  }
  function poolForLocale() {
    const key = gameLocale === "zh-CN" ? "zh" : gameLocale;
    return LOCALE_POOL[key] || LOCALE_POOL.en; // ko / unsupported -> English voices
  }
  function voiceFor(speaker, isCJK) {
    // Chinese text always gets Chinese voices; otherwise follow the game locale.
    const p = isCJK ? LOCALE_POOL.zh : poolForLocale();
    if (!speaker) {
      return { voice: p.mod, language: VOICE_LANG[p.mod] || "en-US" };
    }
    const v = p.pool[speakerIndex(speaker) % p.pool.length];
    return { voice: v, language: VOICE_LANG[v] || "en-US" };
  }

  function clip(text) {
    const t = text.trim();
    if (t.length <= MAX_CHARS) return t;
    const cut = t.slice(0, MAX_CHARS);
    const sp = cut.lastIndexOf(" ");
    return sp > MAX_CHARS * 0.6 ? cut.slice(0, sp) : cut;
  }
  const cacheKey = (speaker, text) => `${speaker || "__mod__"}|${text}`;

  // ── network ────────────────────────────────────────────────
  async function resolveUrl(speaker, text) {
    const key = cacheKey(speaker, text);
    const rec = cache.get(key);
    if (rec && rec.url) return rec.url;

    const clipped = clip(text);
    const { voice, language } = voiceFor(speaker, CJK.test(clipped));
    const res = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clipped, voice, language, speed: 1.0 }),
    });
    if (!res.ok) {
      let msg = `voice service error ${res.status}`;
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    const data = await res.json();
    const url = BASE + data.audioUrl;
    cache.set(key, { ...(rec || {}), url });
    return url;
  }

  async function getAudio(speaker, text) {
    const key = cacheKey(speaker, text);
    const rec = cache.get(key);
    if (rec && rec.audio) return rec.audio;
    const url = await resolveUrl(speaker, text);
    const audio = new Audio(url);
    audio.preload = "auto";
    cache.set(key, { url, audio });
    return audio;
  }

  // ── playback ───────────────────────────────────────────────
  function stopCurrent() {
    if (currentAudio && !currentAudio.paused) {
      try { currentAudio.pause(); } catch (e) {}
    }
  }

  async function startPlayback(btn, speaker, text) {
    stopCurrent();
    setBtn(btn, "loading");
    let audio;
    try {
      audio = await getAudio(speaker, text);
    } catch (e) {
      setBtn(btn, "error", e.message);
      throw e;
    }
    currentAudio = audio;
    currentBtn = btn;

    let resolveEnded;
    const ended = new Promise((r) => (resolveEnded = r));
    audio.onended = () => { if (currentBtn === btn) setBtn(btn, "idle"); resolveEnded(); };
    audio.onpause = () => {
      if (currentBtn === btn && !audio.ended) { setBtn(btn, "idle"); resolveEnded(); }
    };
    try {
      audio.currentTime = 0;
      await audio.play();
      setBtn(btn, "playing");
    } catch (e) {
      setBtn(btn, "error", "playback blocked by browser");
      resolveEnded();
      throw e;
    }
    return ended;
  }

  async function onPlayClick(btn, speaker, text) {
    // Clicking the currently-playing line pauses it.
    if (currentBtn === btn && currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      return;
    }
    try { await startPlayback(btn, speaker, text); } catch (e) {}
  }

  function enqueue(speaker, text, btn) {
    queue = queue.then(async () => {
      if (!autoplay) return;
      try {
        const ended = await startPlayback(btn, speaker, text);
        await ended;
      } catch (e) {}
    });
  }

  // ── button state ───────────────────────────────────────────
  function setBtn(btn, state, title) {
    if (!btn) return;
    btn.classList.remove("loading", "playing", "error");
    btn.disabled = false;
    if (state === "loading") {
      btn.textContent = "◌"; btn.classList.add("loading");
      btn.disabled = true; btn.title = "Generating voice…";
    } else if (state === "playing") {
      btn.textContent = "⏸"; btn.classList.add("playing"); btn.title = "Pause";
    } else if (state === "error") {
      btn.textContent = "⚠"; btn.classList.add("error"); btn.title = title || "voice error";
    } else {
      btn.textContent = "▶"; btn.title = "Play voice";
    }
  }

  // ── status badge ───────────────────────────────────────────
  function setStatus(text, cls) {
    const el = document.getElementById("ttsStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "tts-status" + (cls ? " " + cls : "");
  }

  async function checkHealth() {
    try {
      const r = await fetch(`${BASE}/api/health`);
      const d = await r.json();
      available = true;
      if (d.pipelineLoaded) setStatus(`🔊 ${(d.device || "cpu").toUpperCase()}`, "ok");
      else setStatus("🔊 loading model…", "warn");
    } catch (e) {
      available = false;
      setStatus("🔇 voice off (run kokoro :8000)", "down");
    }
  }

  // ── public API ─────────────────────────────────────────────
  function decorate(div, speaker, text) {
    if (!text || !text.trim()) return null;
    const btn = document.createElement("button");
    btn.className = "playbtn";
    btn.type = "button";
    setBtn(btn, "idle");
    btn.addEventListener("click", () => onPlayClick(btn, speaker || "", text));
    div.insertBefore(btn, div.firstChild);
    if (autoplay) enqueue(speaker || "", text, btn);
    return btn;
  }

  function setAutoplay(on) {
    autoplay = !!on;
    if (!autoplay) { stopCurrent(); queue = Promise.resolve(); }
  }

  function setLocale(l) {
    gameLocale = l || "en";
  }

  function reset() {
    stopCurrent();
    queue = Promise.resolve();
    cache.clear();
    rosterIndex.clear();
    currentAudio = null;
    currentBtn = null;
  }

  function init() {
    checkHealth();
    // re-check periodically until the service is up / model is loaded
    const timer = setInterval(() => {
      checkHealth();
    }, 5000);
    // stop polling once ready and model loaded
    const stopWhenReady = setInterval(() => {
      const el = document.getElementById("ttsStatus");
      if (el && el.classList.contains("ok")) { clearInterval(timer); clearInterval(stopWhenReady); }
    }, 5000);
  }

  window.WIH_TTS = { decorate, setRoster, setAutoplay, setLocale, reset, init, get base() { return BASE; }, get available() { return available; } };
})();
