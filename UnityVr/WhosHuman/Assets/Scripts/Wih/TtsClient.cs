using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Wih
{
    /// <summary>
    /// Optional voice output via the local Kokoro TTS service (default :8000).
    /// Mirrors public/tts.js: per-agent stable voice, locale pools, Chinese
    /// auto-detect. Fails silently if the service is down — the game is unaffected.
    /// </summary>
    public class TtsClient : MonoBehaviour
    {
        public string ttsBase = "http://127.0.0.1:8000";
        public bool enabledVoice = true;
        public string locale = "en";

        private static readonly Regex Han = new Regex(@"[㐀-鿿豈-﫿]");

        private const string EnMod = "bm_george";
        private static readonly string[] EnPool = { "af_heart", "am_michael", "bf_emma", "am_fenrir", "af_bella", "am_puck", "af_nicole", "bm_fable" };
        private const string ZhMod = "zf_xiaoxiao";
        private static readonly string[] ZhPool = { "zm_yunxi", "zf_xiaoxiao" };
        private static readonly string[] EsPool = { "ef_dora", "em_alex", "em_santa" };
        private static readonly string[] FrPool = { "ff_siwis" };
        private static readonly string[] HiPool = { "hf_alpha", "hf_beta", "hm_omega", "hm_psi" };

        private static readonly Dictionary<string, string> VoiceLang = new Dictionary<string, string>
        {
            { "af_heart", "en-US" }, { "af_bella", "en-US" }, { "af_nicole", "en-US" },
            { "am_michael", "en-US" }, { "am_fenrir", "en-US" }, { "am_puck", "en-US" },
            { "bf_emma", "en-GB" }, { "bm_george", "en-GB" }, { "bm_fable", "en-GB" },
            { "zf_xiaoxiao", "zh-CN" }, { "zm_yunxi", "zh-CN" },
            { "ef_dora", "es" }, { "em_alex", "es" }, { "em_santa", "es" },
            { "ff_siwis", "fr-fr" },
            { "hf_alpha", "hi" }, { "hf_beta", "hi" }, { "hm_omega", "hi" }, { "hm_psi", "hi" },
        };

        private readonly Dictionary<string, int> _roster = new Dictionary<string, int>();
        private readonly Dictionary<string, AudioClip> _cache = new Dictionary<string, AudioClip>();
        private bool _warned;

        /// <summary>Voices are on AND the service hasn't failed yet. The playback loop uses
        /// this to decide whether to wait for spoken audio (avoids overlap) or just pace by text.</summary>
        public bool Reachable => enabledVoice && !_warned;

        public void SetRoster(IEnumerable<string> ids)
        {
            var sorted = new List<string>(ids);
            sorted.Sort(System.StringComparer.Ordinal);
            _roster.Clear();
            for (int i = 0; i < sorted.Count; i++) _roster[sorted[i]] = i;
        }

        public void Reset()
        {
            _cache.Clear();
        }

        private (string voice, string lang) VoiceFor(string speaker, bool isCjk)
        {
            string[] pool;
            string mod;
            if (isCjk) { pool = ZhPool; mod = ZhMod; }
            else
            {
                switch (locale)
                {
                    case "zh-CN": pool = ZhPool; mod = ZhMod; break;
                    case "es": pool = EsPool; mod = "em_santa"; break;
                    case "fr": pool = FrPool; mod = "ff_siwis"; break;
                    case "hi": pool = HiPool; mod = "hm_omega"; break;
                    default: pool = EnPool; mod = EnMod; break; // en / ko(fallback)
                }
            }
            string v;
            if (string.IsNullOrEmpty(speaker)) v = mod;
            else { int idx = _roster.TryGetValue(speaker, out var i) ? i : 0; v = pool[idx % pool.Length]; }
            return (v, VoiceLang.TryGetValue(v, out var l) ? l : "en-US");
        }

        /// <summary>Synthesize and play `text` on `output`. Moderator lines: speaker null/empty.</summary>
        public void Speak(string speaker, string text, AudioSource output)
        {
            if (!enabledVoice || output == null || string.IsNullOrWhiteSpace(text)) return;
            StartCoroutine(SpeakRoutine(speaker ?? "", text, output));
        }

        private IEnumerator SpeakRoutine(string speaker, string text, AudioSource output)
        {
            string clipped = text.Trim();
            if (clipped.Length > 500) clipped = clipped.Substring(0, 500);
            string key = speaker + "|" + clipped;
            if (_cache.TryGetValue(key, out var cached) && cached != null)
            {
                output.Stop(); output.clip = cached; output.Play();
                yield break;
            }

            bool isCjk = Han.IsMatch(clipped);
            var (voice, lang) = VoiceFor(speaker, isCjk);

            var reqBody = new JObject
            {
                ["text"] = clipped,
                ["voice"] = voice,
                ["language"] = lang,
                ["speed"] = 1.0,
            }.ToString();

            string audioUrl = null;
            using (var post = new UnityWebRequest($"{ttsBase}/api/tts", "POST"))
            {
                post.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(reqBody));
                post.downloadHandler = new DownloadHandlerBuffer();
                post.SetRequestHeader("Content-Type", "application/json");
                yield return post.SendWebRequest();
                if (post.result != UnityWebRequest.Result.Success)
                {
                    if (!_warned) { Debug.LogWarning($"[Wih] TTS unavailable ({post.error}) — voices off."); _warned = true; }
                    yield break;
                }
                try
                {
                    var j = JObject.Parse(post.downloadHandler.text);
                    audioUrl = (string)j["audioUrl"];
                }
                catch { yield break; }
            }
            if (string.IsNullOrEmpty(audioUrl)) yield break;

            string wavUrl = ttsBase + audioUrl;
            using (var dl = UnityWebRequestMultimedia.GetAudioClip(wavUrl, AudioType.WAV))
            {
                yield return dl.SendWebRequest();
                if (dl.result != UnityWebRequest.Result.Success) yield break;
                var clip = DownloadHandlerAudioClip.GetContent(dl);
                if (clip == null) yield break;
                _cache[key] = clip;
                output.Stop(); output.clip = clip; output.Play();
            }
        }
    }
}
