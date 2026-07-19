using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Consumes GameClient events and drives the scene: avatars (speaking/alive/
    /// reveal), the world-space UI (transcript/role/input), and the spatial TTS.
    /// Routes the human's VR/mouse input back to the server.
    /// </summary>
    public class GameDirector : MonoBehaviour
    {
        public GameClient client;
        public GameUi ui;
        public TtsClient tts;
        public AudioSource moderatorAudio;

        private readonly Dictionary<string, AgentAvatar> _avatars = new Dictionary<string, AgentAvatar>();
        private readonly List<string> _notes = new List<string>();
        private string _humanId, _locale = "en";

        // pending human decision
        private string _reqId, _kind, _selfRole, _instruction;
        private readonly List<string> _legalTargets = new List<string>();
        private bool _canAbstain;

        // sequential speech playback — reveal + speak one line at a time
        private struct Line { public string who, text, color, speaker, kind; }
        private readonly Queue<Line> _speakQueue = new Queue<Line>();
        private bool _awaitPending;      // a human prompt is waiting for the queue to drain
        private int _gen;                // bumped each new game → stale queued/playing lines are dropped
        private string _lastShown = "";  // dedupe consecutive identical lines (buffer replays)
        // Death is applied VISUALLY when the "Dawn breaks…/eliminated" line plays, not
        // when the snapshot arrives — so foxes fall in sync with the announcement.
        private readonly HashSet<string> _announcedDead = new HashSet<string>();
        private readonly Dictionary<string, string> _pendingReveal = new Dictionary<string, string>();
        private bool _gameActive;         // between game_start and result → show a thinking cue during waits
        private string _thinkingSpeaker;  // who the server is currently asking (from turn events)
        private GazeReporter _gaze;

        private static readonly Dictionary<string, string> RoleToNight = new Dictionary<string, string>
        {
            { "werewolf", "WEREWOLF_KILL" }, { "seer", "SEER_INSPECT" }, { "doctor", "DOCTOR_PROTECT" },
        };

        private void Awake()
        {
            if (client == null) client = GetComponent<GameClient>();
            if (tts == null) tts = GetComponent<TtsClient>();
            if (moderatorAudio == null)
            {
                moderatorAudio = gameObject.AddComponent<AudioSource>();
                moderatorAudio.spatialBlend = 0f; moderatorAudio.playOnAwake = false;
            }
            foreach (var a in FindObjectsByType<AgentAvatar>(FindObjectsSortMode.None))
            {
                _avatars[a.id] = a;
                a.Clicked += OnAgentClicked;
            }
            _gaze = FindFirstObjectByType<GazeReporter>();
        }

        private void Start()
        {
            if (ui != null) ui.Build();
            if (client != null)
            {
                client.OnGameEvent += HandleEvent;
                client.OnConnectionChanged += c => ui?.SetConnected(c);
            }
            StartCoroutine(PlaybackLoop());
        }

        private void OnDestroy()
        {
            if (client != null) client.OnGameEvent -= HandleEvent;
            foreach (var a in _avatars.Values) if (a != null) a.Clicked -= OnAgentClicked;
        }

        // ── event dispatch ──────────────────────────────────────
        private void HandleEvent(JObject e)
        {
            // Ignore everything until the player has actually pressed Start / New Game,
            // so a stale or replayed game never runs behind the menu.
            if (client != null && !client.GameRequested) return;
            switch (Str(e["type"]))
            {
                case "game_start": OnGameStart(e); break;
                case "snapshot": OnSnapshot(e["snapshot"] as JObject); break;
                case "turn": OnTurn(Str(e["speaker"])); break;
                case "transcript": OnTranscript(e["entry"] as JObject); break;
                case "private": OnPrivate(Str(e["text"])); break;
                case "awaiting_input": OnAwaiting(e["request"] as JObject); break;
                case "input_cleared": ClearInput(); break;
                case "result": OnResult(e); break;
                case "error": ui?.SetStatus("⚠ " + Str(e["text"])); break;
            }
        }

        private void OnGameStart(JObject e)
        {
            _humanId = Str(e["humanId"]);
            _locale = Str(e["locale"]) ?? "en";
            if (tts != null) { tts.locale = _locale; tts.Reset(); }

            // ── HARD RESET (also drops any stale queued/playing lines + audio) ──
            _gen++;                       // invalidate the line currently in PlaybackLoop
            _speakQueue.Clear();
            _awaitPending = false;
            _lastShown = "";
            _announcedDead.Clear();
            _pendingReveal.Clear();
            _gameActive = true;
            _thinkingSpeaker = null;
            _notes.Clear();
            ui?.ResetTranscript();
            ui?.HideInput();
            foreach (var a in _avatars.Values)
            {
                if (a == null) continue;
                a.StopVoice();       // silence anyone mid-sentence from the old game
                a.ResetVisual();     // un-hide (incl. the previous human's fox), stand up, alive
            }
            if (moderatorAudio != null) moderatorAudio.Stop();

            // The human IS one of the foxes: sit at that seat, hide that fox, and
            // tell the gaze reporter to ignore it.
            if (!string.IsNullOrEmpty(_humanId) && _avatars.TryGetValue(_humanId, out var me))
            {
                MovePlayerToSeat(me.transform);
                me.SetHiddenAsHuman();
                ui?.PlaceInFront();   // move the dashboard to the new seat
            }
            if (_gaze != null) { _gaze.humanId = _humanId; _gaze.Refresh(); }

            ui?.SetStatus($"new game · you are {_humanId}");
        }

        // Put the VR rig where the human's fox sits, facing the table centre.
        private void MovePlayerToSeat(Transform seat)
        {
            var rig = FindPlayerRig();
            if (rig == null || seat == null) return;
            Vector3 p = seat.position; p.y = 0f;
            Vector3 toCenter = -new Vector3(p.x, 0f, p.z);
            Quaternion rot = toCenter.sqrMagnitude > 1e-4f
                ? Quaternion.LookRotation(toCenter.normalized, Vector3.up)
                : Quaternion.identity;
            rig.SetPositionAndRotation(p, rot);
        }

        private static Transform FindPlayerRig()
        {
            var xr = GameObject.Find("XR Origin (XR Rig)") ?? GameObject.Find("XR Origin Hands (XR Rig)") ?? GameObject.Find("XR Origin");
            if (xr != null) return xr.transform;
            return Camera.main != null ? Camera.main.transform.root : null;
        }

        private void OnSnapshot(JObject snap)
        {
            if (snap == null) return;
            var players = snap["players"] as JArray;
            if (players != null)
            {
                var ids = new List<string>();
                foreach (var p in players)
                {
                    string id = Str(p["id"]);
                    ids.Add(id);
                    if (!_avatars.TryGetValue(id, out var av)) continue;
                    bool alive = p["alive"]?.Value<bool>() ?? true;
                    string roleLabel = Str(p["revealedRoleLabel"]);
                    if (alive)
                    {
                        av.SetAlive(true);
                    }
                    else if (_announcedDead.Contains(id))
                    {
                        av.SetAlive(false);                                     // already announced → stay down
                        if (!string.IsNullOrEmpty(roleLabel)) av.ShowRevealed(roleLabel);
                    }
                    else
                    {
                        av.SetAlive(true);                                      // died but NOT yet announced → keep standing
                        if (!string.IsNullOrEmpty(roleLabel)) _pendingReveal[id] = roleLabel; // fall + reveal when the line plays
                    }
                }
                if (tts != null) tts.SetRoster(ids);
            }

            var you = snap["you"] as JObject;
            if (you != null)
            {
                var notes = you["privateNotes"] as JArray;
                _notes.Clear();
                if (notes != null) foreach (var n in notes) _notes.Add(Str(n));
                RefreshNotes(you);
            }

            string phase = Str(snap["phase"]);
            int round = snap["round"]?.Value<int>() ?? 0;
            ui?.SetStatus($"DAY {round} · {Pretty(phase)} · you = {_humanId}");
        }

        private void OnTurn(string speaker)
        {
            // The server is asking this agent → they're thinking. The playback loop
            // shows an animated cue while we wait for their line.
            _thinkingSpeaker = string.IsNullOrEmpty(speaker) ? null : Name(speaker);
        }

        private string Name(string id)
        {
            return !string.IsNullOrEmpty(id) && _avatars.TryGetValue(id, out var a) && !string.IsNullOrEmpty(a.displayName)
                ? a.displayName : id;
        }

        private void OnTranscript(JObject entry)
        {
            if (entry == null) return;
            _thinkingSpeaker = null; // a line arrived → whoever was thinking has answered
            string kind = Str(entry["kind"]);
            string speaker = Str(entry["speaker"]);
            // Queue it — the playback loop reveals + speaks lines one at a time so the
            // next agent only appears once the previous has finished.
            _speakQueue.Enqueue(new Line
            {
                who = string.IsNullOrEmpty(speaker) ? "" : Name(speaker),
                text = Str(entry["text"]),
                color = ColorFor(kind, speaker),
                speaker = speaker,
                kind = kind,
            });
        }

        // ── sequential speech playback ──────────────────────────
        private IEnumerator PlaybackLoop()
        {
            var gap = new WaitForSeconds(0.25f);
            while (true)
            {
                if (_speakQueue.Count > 0)
                {
                    int gen = _gen;
                    var line = _speakQueue.Dequeue();
                    // Skip duplicates (buffer replays re-send the same lines).
                    string sig = line.speaker + "|" + line.text;
                    if (sig == _lastShown) continue;
                    _lastShown = sig;

                    ui?.HideThinking();
                    // Let the night settle a beat before "Dawn breaks…".
                    if (line.kind == "death") { yield return new WaitForSeconds(1f); if (gen != _gen) continue; }

                    ui?.AppendLine(line.who, line.text, line.color);
                    // Fall the victim exactly when the announcement is shown (night death,
                    // or a lynch elimination — a moderator-spoken "vote" line).
                    if (line.kind == "death" || (line.kind == "vote" && string.IsNullOrEmpty(line.speaker)))
                        ApplyDeath(line.text);

                    // Individual vote casts are revealed together AFTER everyone voted:
                    // flash them quickly, no speaking, no TTS.
                    if (line.kind == "vote" && !string.IsNullOrEmpty(line.speaker))
                    {
                        yield return new WaitForSeconds(0.35f);
                        continue;
                    }

                    Highlight(line.speaker);
                    var src = SpeakerAudio(line.speaker);
                    tts?.Speak(line.speaker ?? "", line.text, src);
                    yield return WaitForLine(line.text, src, gen);
                    Highlight(null);
                    yield return gap;
                }
                else
                {
                    if (_awaitPending) { _awaitPending = false; ui?.HideThinking(); PresentAwaiting(); }
                    else if (_gameActive && string.IsNullOrEmpty(_reqId))
                        // queue drained, waiting on the server → animated thinking cue
                        ui?.ShowThinking(!string.IsNullOrEmpty(_thinkingSpeaker) ? $"{_thinkingSpeaker} is thinking" : "the foxes are thinking");
                    yield return null;
                }
            }
        }

        private AudioSource SpeakerAudio(string speaker)
        {
            if (!string.IsNullOrEmpty(speaker) && _avatars.TryGetValue(speaker, out var av) && av.audioSource != null)
                return av.audioSource;
            return moderatorAudio;
        }

        // Parse the victim id from an announcement ("Dawn breaks. A-07 did not survive…"
        // / "A-03 was eliminated…") and make them fall + reveal, right on cue.
        private void ApplyDeath(string text)
        {
            var m = System.Text.RegularExpressions.Regex.Match(text ?? "", "A-0[0-9]");
            if (!m.Success) return;
            string id = m.Value;
            if (_announcedDead.Contains(id) || !_avatars.TryGetValue(id, out var av)) return;
            _announcedDead.Add(id);
            av.SetAlive(false);
            if (_pendingReveal.TryGetValue(id, out var label) && !string.IsNullOrEmpty(label)) av.ShowRevealed(label);
        }

        // Highlight the current speaker; everyone else turns partially toward them.
        private void Highlight(string speaker)
        {
            Transform spk = (!string.IsNullOrEmpty(speaker) && _avatars.TryGetValue(speaker, out var sa)) ? sa.LookPoint : null;
            foreach (var kv in _avatars)
            {
                bool isSpk = kv.Key == speaker;
                kv.Value.SetSpeaking(isSpk);
                kv.Value.SetLookTarget(isSpk ? null : spk);
            }
        }

        // Hold on a line long enough that the next speaker never overlaps it.
        //  • With TTS: wait for the (async) audio to START, then to FINISH — no 9s cut.
        //  • Without TTS: pace by text length.
        // Aborts instantly if a new game started (gen changed).
        private IEnumerator WaitForLine(string text, AudioSource src, int gen)
        {
            float min = Mathf.Clamp((text?.Length ?? 0) * 0.05f, 1.4f, 7f);
            bool useTts = tts != null && tts.Reachable && src != null;
            float t = 0f;

            if (useTts)
            {
                while (t < 3f && !src.isPlaying)   // wait for the fetch to start playback
                {
                    if (gen != _gen) yield break;
                    t += Time.deltaTime; yield return null;
                }
                if (src.isPlaying)
                {
                    while (t < 45f)                 // then wait it out fully (generous cap)
                    {
                        if (gen != _gen) yield break;
                        if (t >= min && !src.isPlaying) break;
                        t += Time.deltaTime; yield return null;
                    }
                    yield break;
                }
                // TTS didn't start (service down) → fall through to text pacing
            }

            while (t < min)
            {
                if (gen != _gen) yield break;
                t += Time.deltaTime; yield return null;
            }
        }

        private void OnPrivate(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            _notes.Add(text);
            ui?.SetNotes("Private notes:\n" + string.Join("\n", _notes));
        }

        private void RefreshNotes(JObject you)
        {
            string role = Str(you["roleLabel"]) ?? Str(you["role"]);
            string fn = Str(you["functionName"]);
            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"YOU {_humanId} — cover: {fn}");
            sb.AppendLine($"secret role: {role}");
            if (_notes.Count > 0) { sb.AppendLine(); foreach (var n in _notes) sb.AppendLine("• " + n); }
            ui?.SetNotes(sb.ToString());
        }

        private void OnAwaiting(JObject req)
        {
            if (req == null) return;
            _reqId = Str(req["requestId"]);
            _kind = Str(req["kind"]);
            _selfRole = Str(req["self"]?["role"]);
            _canAbstain = req["options"]?["canAbstain"]?.Value<bool>() ?? false;
            _legalTargets.Clear();
            var lt = req["options"]?["legalTargets"] as JArray;
            if (lt != null) foreach (var t in lt) _legalTargets.Add(Str(t));
            _instruction = Str(req["instruction"]);
            // Defer: only surface the human's prompt once earlier lines have been spoken.
            _awaitPending = true;
        }

        // Show the human's input UI (called by the playback loop when the queue drains).
        private void PresentAwaiting()
        {
            bool targetKind = _kind == "NIGHT_ACTION" || _kind == "LYNCH_VOTE";
            foreach (var kv in _avatars) kv.Value.SetTargetable(targetKind && _legalTargets.Contains(kv.Key));
            if (targetKind)
                ui?.ShowTargets(_instruction, _legalTargets, _canAbstain, OnPickTarget);
            else
                ui?.ShowSpeech(_instruction, _kind == "OPENING_STATEMENT", _legalTargets, OnSendSpeech);
            ui?.SetStatus($"YOUR TURN — {Pretty(_kind)}");
        }

        // ── human input → server ────────────────────────────────
        private void OnPickTarget(string target)
        {
            if (string.IsNullOrEmpty(_reqId)) return;
            JObject resp;
            if (_kind == "NIGHT_ACTION")
            {
                string type = RoleToNight.TryGetValue(_selfRole ?? "", out var t) ? t : "NONE";
                resp = new JObject { ["nightAction"] = new JObject { ["type"] = type, ["target"] = target } };
            }
            else // LYNCH_VOTE
            {
                resp = new JObject { ["lynchVote"] = target };
            }
            Submit(resp);
        }

        private void OnSendSpeech(string text, string lean)
        {
            if (string.IsNullOrEmpty(_reqId)) return;
            var resp = new JObject { ["publicMessage"] = text };
            if (_kind == "OPENING_STATEMENT") resp["lynchVote"] = lean; // server reads lynchVote, not lynchVoteIntent
            Submit(resp);
        }

        private void OnAgentClicked(string id)
        {
            if (string.IsNullOrEmpty(_reqId)) return;
            if ((_kind == "NIGHT_ACTION" || _kind == "LYNCH_VOTE") && _legalTargets.Contains(id))
                OnPickTarget(id);
        }

        private void Submit(JObject response)
        {
            client?.SubmitInput(_reqId, response);
            ClearInput();
        }

        private void ClearInput()
        {
            _reqId = null; _kind = null;
            _awaitPending = false;
            ui?.HideInput();
            foreach (var kv in _avatars) kv.Value.SetTargetable(false);
        }

        private void OnResult(JObject e)
        {
            _gameActive = false;
            ui?.HideThinking();
            var result = e["result"] as JObject;
            var reveal = e["reveal"] as JArray;
            if (reveal != null)
                foreach (var c in reveal)
                {
                    string id = Str(c["id"]);
                    if (_avatars.TryGetValue(id, out var av))
                    {
                        av.SetAlive(c["alive"]?.Value<bool>() ?? true);
                        av.ShowRevealed(Str(c["revealedRoleLabel"]) ?? Str(c["revealedRole"]));
                    }
                }
            if (result != null)
            {
                // Show every "who is the human?" vote AT ONCE (no per-ballot narration).
                var ballots = result["auditBallots"] as JArray;
                if (ballots != null && ballots.Count > 0)
                {
                    var sb = new System.Text.StringBuilder("Human audit — all votes:");
                    foreach (var b in ballots)
                        sb.Append($"\n  {Name(Str(b["voter"]))} -> {Name(Str(b["targetPlayerId"]))}");
                    ui?.AppendLine("", sb.ToString(), "#c0a3ff");
                }
                string outcome = Str(result["finalOutcome"]);
                int score = result["score"]?.Value<int>() ?? 0;
                int votes = result["votesAgainstHuman"]?.Value<int>() ?? 0;
                int need = result["detectionThreshold"]?.Value<int>() ?? 4;
                bool detected = result["humanDetected"]?.Value<bool>() ?? false;
                ui?.SetStatus($"RESULT: {outcome?.ToUpper()} · score {score}/2 · audit {votes}/6 (need {need}) · {(detected ? "DETECTED" : "hidden")}");
                ui?.AppendLine("", $"FINAL: {outcome} (score {score}/2)", "#4ade80");
            }
            // offer a restart (single button)
            ui?.ShowTargets("Game over — play again?", new List<string> { "New Game" }, false, _ => client?.NewGame());
        }

        // ── helpers ─────────────────────────────────────────────
        private static string Str(JToken t) => t == null || t.Type == JTokenType.Null ? null : t.ToString();

        private string ColorFor(string kind, string speaker)
        {
            if (!string.IsNullOrEmpty(speaker) && speaker == _humanId) return "#ffd166";
            switch (kind)
            {
                case "death": return "#ff6b6b";
                case "vote": return "#c0a3ff";
                case "result": return "#4ade80";
                case "opening":
                case "discussion":
                case "defense": return "#5ac8fa";
                default: return "#8b93a3"; // system/moderator
            }
        }

        private static string Pretty(string s) => string.IsNullOrEmpty(s) ? "" : s.Replace("_", " ");
    }
}
