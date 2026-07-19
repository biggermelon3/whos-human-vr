"use strict";

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  health: $("health"),
  presets: $("presets"),
  language: $("language"),
  voice: $("voice"),
  speed: $("speed"),
  speedValue: $("speedValue"),
  text: $("text"),
  charCount: $("charCount"),
  generate: $("generate"),
  status: $("status"),
  error: $("error"),
  result: $("result"),
  player: $("player"),
  play: $("play"),
  download: $("download"),
  metaDuration: $("metaDuration"),
  metaCache: $("metaCache"),
  metaVoice: $("metaVoice"),
};

let CATALOG = { languages: [], voices: [], presets: [], defaults: {} };

const LANG_PLACEHOLDER = {
  "en-US": "Type what the character should say…",
  "en-GB": "Type what the character should say…",
  "zh-CN": "输入角色要说的话……",
};

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
}

function clearError() {
  el.error.hidden = true;
  el.error.textContent = "";
}

function setLoading(loading) {
  el.generate.disabled = loading;
  el.status.className = loading ? "status loading" : "status";
  el.status.textContent = loading ? "Generating…" : "";
}

// --------------------------------------------------------------------------
// Populate dropdowns / presets from the catalog
// --------------------------------------------------------------------------
function voicesForLanguage(languageId) {
  return CATALOG.voices.filter((v) => v.language === languageId);
}

function populateLanguages() {
  el.language.innerHTML = "";
  for (const lang of CATALOG.languages) {
    const opt = document.createElement("option");
    opt.value = lang.id;
    opt.textContent = lang.label;
    el.language.appendChild(opt);
  }
  el.language.value = CATALOG.defaults.language || CATALOG.languages[0]?.id;
}

function populateVoices(languageId, preferredVoice) {
  el.voice.innerHTML = "";
  const list = voicesForLanguage(languageId);
  for (const v of list) {
    const opt = document.createElement("option");
    opt.value = v.id;
    const g = v.gender === "female" ? "F" : "M";
    opt.textContent = `${v.label} (${g} · ${v.grade})`;
    el.voice.appendChild(opt);
  }
  if (preferredVoice && list.some((v) => v.id === preferredVoice)) {
    el.voice.value = preferredVoice;
  } else if (list.length > 0) {
    el.voice.value = list[0].id;
  }
}

function populatePresets() {
  el.presets.innerHTML = "";
  for (const p of CATALOG.presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    const voiceLabel =
      CATALOG.voices.find((v) => v.id === p.voice)?.label || p.voice;
    btn.innerHTML =
      `<span class="preset-name">${p.name}</span>` +
      `<span class="preset-sub">${voiceLabel} · ${p.language} · ${p.speed.toFixed(
        2
      )}×</span>`;
    btn.addEventListener("click", () => applyPreset(p));
    el.presets.appendChild(btn);
  }
}

function applyPreset(p) {
  el.language.value = p.language;
  populateVoices(p.language, p.voice);
  el.speed.value = String(p.speed);
  el.speedValue.textContent = Number(p.speed).toFixed(2);
  el.text.value = p.sample;
  updateCharCount();
  clearError();
  el.text.focus();
}

function updateCharCount() {
  el.charCount.textContent = `${el.text.value.length} / 500`;
}

// --------------------------------------------------------------------------
// Health
// --------------------------------------------------------------------------
async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const ready = data.pipelineLoaded;
    el.health.className = "health " + (ready ? "ok" : "warn");
    el.health.textContent = ready
      ? `● ${data.model} ready · ${data.device.toUpperCase()} · ${data.sampleRate} Hz`
      : `● ${data.model} loading… (first run downloads the model)`;
  } catch {
    el.health.className = "health down";
    el.health.textContent = "● server unreachable";
  }
}

// --------------------------------------------------------------------------
// Generate
// --------------------------------------------------------------------------
async function generate() {
  clearError();
  const text = el.text.value.trim();
  if (!text) {
    showError("Please enter some text first.");
    return;
  }

  const body = {
    text,
    voice: el.voice.value,
    language: el.language.value,
    speed: Number(el.speed.value),
  };

  setLoading(true);
  el.result.hidden = true;
  const started = performance.now();

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const elapsedMs = Math.round(performance.now() - started);

    if (!res.ok) {
      let message = `Request failed (HTTP ${res.status}).`;
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) {
          message = `${err.error.message} [${err.error.code}]`;
        }
      } catch {
        /* keep default message */
      }
      showError(message);
      return;
    }

    const data = await res.json();

    // Do not autoplay: just load the source and let the user press Play.
    el.player.src = data.audioUrl;
    el.player.load();
    el.download.href = data.audioUrl;
    el.download.setAttribute("download", `${data.voice}-${data.audioId.slice(0, 8)}.wav`);

    el.metaDuration.textContent = `⏱ ${elapsedMs} ms round-trip`;
    el.metaCache.textContent = data.cached ? "⚡ cache hit" : "🆕 freshly generated";
    el.metaCache.className = "chip" + (data.cached ? " hit" : "");
    el.metaVoice.textContent = `${data.voice} · ${data.language} · ${data.speed.toFixed(
      2
    )}×`;
    el.result.hidden = false;
    el.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    showError("Could not reach the server. Is it still running?");
  } finally {
    setLoading(false);
  }
}

// --------------------------------------------------------------------------
// Wire up events
// --------------------------------------------------------------------------
function bindEvents() {
  el.language.addEventListener("change", () => {
    populateVoices(el.language.value);
    el.text.placeholder =
      LANG_PLACEHOLDER[el.language.value] || LANG_PLACEHOLDER["en-US"];
  });
  el.speed.addEventListener("input", () => {
    el.speedValue.textContent = Number(el.speed.value).toFixed(2);
  });
  el.text.addEventListener("input", updateCharCount);
  el.generate.addEventListener("click", generate);
  el.play.addEventListener("click", () => el.player.play());
}

async function init() {
  bindEvents();
  try {
    const res = await fetch("/api/catalog");
    CATALOG = await res.json();
  } catch {
    showError("Failed to load voice catalog from the server.");
    return;
  }
  populateLanguages();
  populateVoices(el.language.value, CATALOG.defaults.voice);
  populatePresets();
  updateCharCount();
  el.text.placeholder =
    LANG_PLACEHOLDER[el.language.value] || LANG_PLACEHOLDER["en-US"];

  refreshHealth();
  // Poll health until the pipeline is loaded (covers first-run model download).
  const timer = setInterval(async () => {
    await refreshHealth();
    if (el.health.classList.contains("ok")) clearInterval(timer);
  }, 3000);
}

init();
