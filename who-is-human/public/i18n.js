// Client-side i18n. All strings are fetched from /messages.json (the same file
// the server reads), so there's one source of truth. English is the fallback.
// Game narration (transcript, moderator lines, private notes) arrives already
// localized from the server.
//
// Wrapped in an IIFE so nothing leaks to the global scope except window.WIH_I18N
// (both this file and app.js are plain <script>s sharing the global scope).
(function () {
  let UI = { en: {} };
  let LOCALE = localStorage.getItem("wih_locale") || "en";

  const ready = fetch("/messages.json")
    .then((r) => r.json())
    .then((json) => {
      UI = json;
      if (!UI[LOCALE]) LOCALE = "en";
    })
    .catch((err) => {
      console.error("[i18n] failed to load messages.json", err);
    });

  function interpolate(s, params) {
    if (!params) return s;
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  function T(key, params) {
    const table = UI[LOCALE] || {};
    const en = UI.en || {};
    const s = table[key] || en[key] || key;
    return interpolate(s, params);
  }

  function setLocale(l) {
    LOCALE = UI[l] ? l : "en";
    localStorage.setItem("wih_locale", LOCALE);
    document.documentElement.setAttribute("lang", LOCALE);
  }

  function applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = T(el.getAttribute("data-i18n"));
    });
    const seed = document.getElementById("seedInput");
    if (seed) seed.placeholder = T("seed.ph");
    const lang = document.getElementById("langSel");
    if (lang) lang.title = T("lang.title");
  }

  window.WIH_I18N = {
    T,
    setLocale,
    applyStatic,
    ready,
    get locale() {
      return LOCALE;
    },
  };
})();
