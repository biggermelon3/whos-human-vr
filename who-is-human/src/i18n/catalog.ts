// ─────────────────────────────────────────────────────────────
// Message catalog. All locale strings live in `public/messages.json` (one flat
// map per locale), read here by the server and fetched by the browser — one
// source of truth. English (`en`) is the fallback for any missing key.
// Templates use {name} placeholders. Player ids (A-0x), action enums and
// numbers are NOT translated — they are passed in as params and kept ASCII.
// ─────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type Locale = "en" | "es" | "zh-CN" | "ko" | "hi" | "fr";

export interface LocaleMeta {
  code: Locale;
  native: string; // shown in the language picker
  llm: string; // language name told to the model
}

export const LOCALES: LocaleMeta[] = [
  { code: "en", native: "English", llm: "English" },
  { code: "es", native: "Español", llm: "Spanish" },
  { code: "zh-CN", native: "简体中文", llm: "Simplified Chinese" },
  { code: "ko", native: "한국어", llm: "Korean" },
  { code: "hi", native: "हिन्दी", llm: "Hindi" },
  { code: "fr", native: "Français", llm: "French" },
];

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && LOCALES.some((l) => l.code === x);
}
export function llmLanguage(locale: Locale): string {
  return LOCALES.find((l) => l.code === locale)?.llm ?? "English";
}

const MESSAGES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "messages.json");

function loadMessages(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(readFileSync(MESSAGES_PATH, "utf8")) as Record<string, Record<string, string>>;
  } catch (err) {
    console.error("[i18n] failed to load messages.json:", (err as Error).message);
    return { en: {} };
  }
}

export const MESSAGES: Record<string, Record<string, string>> = loadMessages();
const EN: Record<string, string> = MESSAGES["en"] ?? {};

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const table = MESSAGES[locale] ?? {};
  let s = table[key] ?? EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export interface LocalizedProfile {
  designation: string;
  functionName: string;
  communicationStyle: string;
  knownLimitation: string;
}

export function localizedProfile(id: string, locale: Locale): LocalizedProfile {
  return {
    designation: id,
    functionName: t(locale, `profile.${id}.function`),
    communicationStyle: t(locale, `profile.${id}.style`),
    knownLimitation: t(locale, `profile.${id}.limit`),
  };
}
