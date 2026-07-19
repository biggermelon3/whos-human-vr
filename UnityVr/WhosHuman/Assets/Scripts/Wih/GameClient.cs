using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Talks to the "who-is-human" Node server (default http://127.0.0.1:8787).
    ///  - Streams the SSE game events from /api/events on a background task and
    ///    hands each parsed event to the main thread via a queue drained in Update.
    ///  - POSTs /api/new (start a game) and /api/input (submit the human's move).
    /// Everything Unity-side (OnGameEvent) runs on the main thread.
    /// </summary>
    public class GameClient : MonoBehaviour
    {
        [Header("Server")]
        [Tooltip("Active server. Switch it with UseLocal()/UseDedicated() from the menu.")]
        public string baseUrl = "http://127.0.0.1:8787";
        [Tooltip("Locally-started server (this PC). On a Quest use the PC's LAN IP, e.g. http://192.168.1.20:8787")]
        public string localUrl = "http://127.0.0.1:8787";
        [Tooltip("Your hosted / dedicated server. Fill this in once it's up, e.g. https://who-is-human.yourdomain.com")]
        public string dedicatedUrl = "";

        [Header("New game defaults")]
        public string backend = "demo";   // demo | api | file
        public string locale = "";         // empty = let the server decide (WIH_LOCALE); else en|es|zh-CN|ko|hi|fr
        public bool autoStartOnPlay = false; // the START MENU begins the game, not auto-play

        /// <summary>Raised on the main thread for every SSE event. Payload is the parsed JSON.</summary>
        public event Action<JObject> OnGameEvent;
        /// <summary>Raised on the main thread when the SSE connection state changes.</summary>
        public event Action<bool> OnConnectionChanged;

        public bool Connected { get; private set; }
        /// <summary>True once the player has actually started a game (Start / New Game). Until then
        /// the director ignores game events, so nothing runs behind the menu (stale/replayed games).</summary>
        public bool GameRequested { get; private set; }

        private readonly ConcurrentQueue<string> _incoming = new ConcurrentQueue<string>();
        private readonly ConcurrentQueue<bool> _connEvents = new ConcurrentQueue<bool>();
        private HttpClient _http;
        private CancellationTokenSource _cts;

        private void Awake()
        {
            _http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        }

        private void OnEnable()
        {
            _cts = new CancellationTokenSource();
            _ = RunSseLoop(_cts.Token);
        }

        private void Start()
        {
            if (autoStartOnPlay) NewGame();
        }

        /// <summary>Point at the locally-started server and reconnect.</summary>
        public bool UseLocal() => SetServer(localUrl);
        /// <summary>Point at your hosted/dedicated server and reconnect. False if it isn't configured.</summary>
        public bool UseDedicated() => SetServer(dedicatedUrl);

        /// <summary>Switch the active server URL and restart the SSE connection. Returns false
        /// if the url is blank (e.g. dedicated not configured yet).</summary>
        public bool SetServer(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return false;
            baseUrl = url.TrimEnd('/');
            // reconnect the event stream to the new server
            try { _cts?.Cancel(); _cts?.Dispose(); } catch { }
            Connected = false;
            _connEvents.Enqueue(false);
            _cts = new CancellationTokenSource();
            _ = RunSseLoop(_cts.Token);
            return true;
        }

        private void Update()
        {
            while (_connEvents.TryDequeue(out var c))
            {
                Connected = c;
                OnConnectionChanged?.Invoke(c);
            }
            // Drain a bounded number per frame so a burst never stalls the frame.
            int budget = 64;
            while (budget-- > 0 && _incoming.TryDequeue(out var json))
            {
                JObject evt = null;
                try { evt = JObject.Parse(json); }
                catch (Exception e) { Debug.LogWarning($"[Wih] bad event json: {e.Message}"); }
                if (evt != null)
                {
                    try { OnGameEvent?.Invoke(evt); }
                    catch (Exception e) { Debug.LogError($"[Wih] event handler threw: {e}"); }
                }
            }
        }

        /// <summary>Pick which backend the next NewGame() uses: "demo" | "api" | "file".</summary>
        public void SetBackend(string b)
        {
            if (b == "api" || b == "file" || b == "demo") backend = b;
        }

        // ── REST ────────────────────────────────────────────────
        public async void NewGame()
        {
            GameRequested = true; // arm the director to process game events from here on
            var body = new JObject
            {
                ["backend"] = backend,
            };
            if (!string.IsNullOrEmpty(locale)) body["locale"] = locale; // else server's WIH_LOCALE decides
            // BYOK: only the "api" (Anthropic) backend needs a key; attach it if the
            // player has pasted one. The key rides in the JSON body to OUR server
            // and is NEVER written to a log (PostJson logs only the path + status).
            if (backend == "api" && ApiKeyStore.HasAgentKey)
                body["apiKey"] = ApiKeyStore.AgentKeyRaw();
            await PostJson("/api/new", body.ToString());
        }

        public async void SubmitInput(string requestId, JObject response)
        {
            var body = new JObject
            {
                ["requestId"] = requestId,
                ["response"] = response,
            };
            await PostJson("/api/input", body.ToString());
        }

        /// <summary>Report the human's body language (which agent they watch + dwell ms) so the
        /// AI agents can read it as a tell. Fire-and-forget; failures are silently ignored.</summary>
        public async void ReportGaze(string target, int dwellMs, int hesitationMs = 0)
        {
            var body = new JObject();
            if (!string.IsNullOrEmpty(target))
                body["gaze"] = new JObject { ["target"] = target, ["dwellMs"] = dwellMs };
            if (hesitationMs > 0) body["hesitationMs"] = hesitationMs;
            if (body.Count == 0) return;
            await PostJson("/api/observe", body.ToString());
        }

        private async Task PostJson(string path, string json)
        {
            try
            {
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var resp = await _http.PostAsync(baseUrl + path, content);
                if (!resp.IsSuccessStatusCode)
                    Debug.LogWarning($"[Wih] POST {path} -> {(int)resp.StatusCode}");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Wih] POST {path} failed: {e.Message}");
            }
        }

        // ── SSE ─────────────────────────────────────────────────
        private async Task RunSseLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/api/events");
                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, token);
                    resp.EnsureSuccessStatusCode();
                    _connEvents.Enqueue(true);

                    using var stream = await resp.Content.ReadAsStreamAsync();
                    using var reader = new System.IO.StreamReader(stream, Encoding.UTF8);

                    while (!token.IsCancellationRequested)
                    {
                        var line = await reader.ReadLineAsync();
                        if (line == null) break;                 // server closed the stream
                        if (line.Length == 0) continue;          // event separator
                        if (line.StartsWith(":")) continue;      // SSE comment / heartbeat
                        if (line.StartsWith("data:"))
                        {
                            var payload = line.Substring(5).Trim();
                            if (payload.Length > 0) _incoming.Enqueue(payload);
                        }
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Wih] SSE disconnected: {e.Message} (retrying in 2s)");
                }

                _connEvents.Enqueue(false);
                if (token.IsCancellationRequested) break;
                try { await Task.Delay(2000, token); } catch { break; }
            }
        }

        private void OnDisable()
        {
            try { _cts?.Cancel(); } catch { }
        }

        private void OnDestroy()
        {
            try { _cts?.Cancel(); _cts?.Dispose(); } catch { }
            try { _http?.Dispose(); } catch { }
        }
    }
}
