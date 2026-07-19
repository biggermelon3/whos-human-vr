using UnityEngine;

namespace Wih
{
    /// <summary>
    /// BYOK (bring-your-own-key) store. Two independent slots because the game
    /// talks to two providers:
    ///   • AGENT key  = Anthropic (sk-ant-…) — drives the 6 AI foxes via the
    ///     server's "api" backend. Sent to OUR server only (never to Anthropic
    ///     directly from the client).
    ///   • VOICE key  = OpenAI  (sk-… / sk-proj-…) — optional, for speech-to-text
    ///     (Whisper). Sent to api.openai.com only.
    /// Keeping them separate means an Anthropic key is NEVER sent to OpenAI and
    /// vice-versa.
    ///
    /// SECURITY RULES (do not weaken):
    ///  • Memory ONLY — keys live in these static fields for the run and are
    ///    wiped on quit. NEVER written to disk: no PlayerPrefs, json,
    ///    ScriptableObject, StreamingAssets, or registry.
    ///  • NEVER logged — a raw key is never passed to Debug.Log / Console /
    ///    request logs / analytics / crash reports. Only the Masked* forms show.
    ///  • Forget() clears both. (A "remember" option would need a native plugin
    ///    to the OS secure store — Windows Credential Manager / macOS Keychain /
    ///    Android Keystore / iOS Keychain — intentionally NOT implemented here;
    ///    memory-only is the safe default.)
    /// </summary>
    public static class ApiKeyStore
    {
        private static string _agentKey; // Anthropic — in-memory only
        private static string _voiceKey; // OpenAI    — in-memory only

        // ── agent (Anthropic) ───────────────────────────────────
        public static bool HasAgentKey => !string.IsNullOrEmpty(_agentKey);
        public static void SetAgentKey(string key) => _agentKey = Clean(key);
        /// <summary>Raw Anthropic key — sent to OUR server's /api/new only. Never log it.</summary>
        public static string AgentKeyRaw() => _agentKey;
        public static string MaskedAgent() => Mask(_agentKey);

        // ── voice (OpenAI) ──────────────────────────────────────
        public static bool HasVoiceKey => !string.IsNullOrEmpty(_voiceKey);
        public static void SetVoiceKey(string key) => _voiceKey = Clean(key);
        /// <summary>Raw OpenAI key — for the Whisper Authorization header only. Never log it.</summary>
        public static string VoiceKeyRaw() => _voiceKey;
        public static string MaskedVoice() => Mask(_voiceKey);

        /// <summary>
        /// Paste-and-route: figures out which slot a key belongs in by its prefix.
        /// sk-ant-… → agent (Anthropic); any other sk-… → voice (OpenAI). Anything
        /// else is assumed to be the agent key. Returns true = agent, false = voice.
        /// </summary>
        public static bool Set(string key)
        {
            string k = Clean(key);
            if (k == null) return true;
            if (k.StartsWith("sk-ant")) { _agentKey = k; return true; }
            if (k.StartsWith("sk-"))    { _voiceKey = k; return false; }
            _agentKey = k; return true; // default: treat as the agent key
        }

        public static void Forget() { _agentKey = null; _voiceKey = null; }

        // ── legacy shims (older call sites) ─────────────────────
        public static bool HasKey => HasAgentKey;
        public static string GetRaw() => _agentKey;
        public static string Masked() => MaskedAgent();

        private static string Clean(string key) => string.IsNullOrWhiteSpace(key) ? null : key.Trim();

        /// <summary>Safe-to-display form, e.g. "sk-ant-a•••••••••7xQ".</summary>
        private static string Mask(string key)
        {
            if (string.IsNullOrEmpty(key)) return "not set";
            if (key.Length <= 12) return "••••";
            return key.Substring(0, 8) + "••••••••" + key.Substring(key.Length - 4);
        }
    }

    /// <summary>Wipes the keys when the app quits — attach once (the builder adds it to the GameManager).</summary>
    public class ApiKeyLifecycle : MonoBehaviour
    {
        private void Awake() => Application.quitting += ApiKeyStore.Forget;
        private void OnApplicationQuit() => ApiKeyStore.Forget();
        private void OnDestroy() => Application.quitting -= ApiKeyStore.Forget;
    }
}
