using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

namespace Wih
{
    /// <summary>
    /// World-space uGUI dashboard built at runtime. Opens on a START MENU (rules +
    /// setup: backend, API/voice key, language) — the game only begins on Start.
    /// In-game: scrollable transcript on the left, role notes + turn prompt + typed/
    /// voice input on the right, quick-reply buttons along the bottom.
    /// </summary>
    public class GameUi : MonoBehaviour
    {
        public Transform anchor;                     // where to place the panel
        public Vector3 panelLocalScale = new Vector3(0.0008f, 0.0008f, 0.0008f);
        public int maxTranscriptLines = 40;
        public SpeechInput speech;                   // optional voice input
        public GameClient client;                    // backend selector + Start/New Game

        [Header("Follow (keeps the dashboard in view + un-occluded)")]
        public float followDist = 0.7f;
        public float followDrop = 0.55f;
        public float followSpeed = 6f;

        private static readonly string[] QuickPhrases =
        {
            "Who do you suspect, and why?",
            "You're being shady — explain yourself.",
            "Start talking. You've said nothing concrete.",
            "We only need one wolf — focus on the shadiest.",
            "You two are moving together. I don't buy it.",
            "That vote timing looks suspicious.",
            "No solid read yet — I'm listening.",
        };

        // "" = let the server decide (WIH_LOCALE). Labels are ASCII (TMP default font).
        private static readonly (string code, string label)[] Languages =
        {
            ("", "Server default"), ("en", "English"), ("zh-CN", "Chinese"),
            ("es", "Spanish"), ("ko", "Korean"), ("hi", "Hindi"), ("fr", "French"),
        };

        private const string RulesText =
            "HOW TO PLAY\n\n" +
            "7 seats, 1 is YOU — the only human, hidden among 6 AI fox agents. You play a full game of Werewolf/Mafia, with a hidden second layer.\n\n" +
            "ROLES (secretly dealt):\n" +
            "- Werewolf x2: each NIGHT the wolves agree on ONE player to kill; blend in by day.\n" +
            "- Seer x1: each night, learn whether one player is werewolf-aligned.\n" +
            "- Doctor x1: each night, protect one player from the kill.\n" +
            "- Villager x3: no night power; by DAY, discuss, deduce and vote to lynch the wolves.\n\n" +
            "A DAY: night actions -> dawn (someone may have died) -> opening statements -> open discussion -> a VOTE to lynch one player. Repeat until a faction wins.\n\n" +
            "FACTIONS:\n" +
            "- Werewolves win by thinning the village until they are no longer outnumbered.\n" +
            "- Village wins by lynching every werewolf.\n\n" +
            ">>> YOUR REAL GOAL (easy to forget!) <<<\n" +
            "You score in TWO ways, and the second is the whole point:\n" +
            "  1) WIN your werewolf faction (play your dealt role well).\n" +
            "  2) STAY HIDDEN. When the game ends, the 6 AI agents secretly vote \"who was the human?\". If 4 or more pick YOU, you are DETECTED.\n" +
            "Final score = (faction won? +1) + (stayed hidden? +1), max 2. You can even LOSE the werewolf game and still WIN by never being caught (an Infiltration Victory).\n\n" +
            "SO: talk and reason like an AI agent. Don't give off human tells — no real-world references, no over-emoting, and mind where your eyes wander (the foxes read your gaze and hesitation).";

        private Canvas _canvas;
        private TextMeshProUGUI _status, _transcript, _notes, _instruction, _keyStatus, _setupStatus, _menuStatus, _langLabel, _connText, _thinking;
        private Image _connLight;
        private RectTransform _inputRow, _textRow, _menu;
        private TMP_InputField _inputField;
        private ScrollRect _transcriptScroll;
        private Action<string, string> _onSend;
        private readonly List<string> _lines = new List<string>();
        private string _lean = "abstain";
        private bool _recording, _snapBottom, _thinkingOn;
        private string _backend = "demo", _thinkingBase = "";
        private int _langIndex;

        public void Build()
        {
            EnsureEventSystem();

            var canvasGo = new GameObject("WihCanvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.WorldSpace;
            _canvas.worldCamera = Camera.main;
            var crt = (RectTransform)canvasGo.transform;
            crt.sizeDelta = new Vector2(1440, 820);
            if (anchor != null) canvasGo.transform.SetParent(anchor, false);
            else PlaceInFront();
            canvasGo.transform.localScale = panelLocalScale;
            AddVrRaycaster(canvasGo);

            var bg = MakePanel(crt, "BG", new Color(0.03f, 0.05f, 0.08f, 0.5f));
            Stretch(bg, 0, 0, 0, 0);

            _status = MakeText(crt, "Status", 26, TextAlignmentOptions.MidlineLeft);
            Place(_status, 0, -8, 1400, 40);
            _status.text = "Press Start when you're ready.";
            _status.color = new Color(0.55f, 0.62f, 0.72f);

            _thinking = MakeText(crt, "Thinking", 22, TextAlignmentOptions.Center);
            Place(_thinking, 0, -46, 1400, 32);
            _thinking.color = new Color(0.72f, 0.82f, 0.55f);
            _thinking.gameObject.SetActive(false);

            // LEFT — the conversation, scrollable
            _transcriptScroll = BuildScroll(crt, -358, -54, 700, 500, 22, out _transcript);

            // RIGHT — role notes, turn prompt, typed input
            _notes = MakeText(crt, "Notes", 20, TextAlignmentOptions.TopLeft);
            Place(_notes, 360, -54, 680, 296);
            _notes.color = new Color(0.8f, 0.82f, 0.6f);

            _instruction = MakeText(crt, "Instruction", 24, TextAlignmentOptions.TopLeft);
            Place(_instruction, 360, -360, 680, 78);
            _instruction.color = new Color(1f, 0.82f, 0.4f);
            _instruction.textWrappingMode = TextWrappingModes.Normal;

            BuildTextRow(crt);

            _inputRow = MakeRow(crt, 0, -574, 1400, 88);

            BuildControlBar(crt);
            BuildMenu(crt);   // shown first; game starts only on Start
            HideInput();
        }

        // ── START MENU ──────────────────────────────────────────
        private void BuildMenu(RectTransform crt)
        {
            var menuGo = new GameObject("Menu", typeof(RectTransform), typeof(Image));
            menuGo.transform.SetParent(crt, false);
            _menu = (RectTransform)menuGo.transform;
            Stretch(_menu, 0, 0, 0, 0);
            menuGo.GetComponent<Image>().color = new Color(0.02f, 0.03f, 0.06f, 0.97f);

            var title = MakeText(_menu, "Title", 42, TextAlignmentOptions.Center);
            Place(title, 0, -16, 1400, 56); title.text = "WHO IS HUMAN"; title.color = new Color(0.92f, 0.85f, 0.55f);
            var sub = MakeText(_menu, "Sub", 20, TextAlignmentOptions.Center);
            Place(sub, 0, -70, 1400, 30); sub.color = new Color(0.6f, 0.66f, 0.78f);
            sub.text = "a reverse-Turing werewolf game — you are the only human among 6 AI foxes";

            // rules (scrollable) on the left
            BuildScroll(_menu, -358, -108, 700, 600, 20, out var rulesText);
            rulesText.text = RulesText; rulesText.color = new Color(0.86f, 0.89f, 0.93f);

            // setup on the right
            const float rx = 360;
            var st = MakeText(_menu, "SetupTitle", 22, TextAlignmentOptions.MidlineLeft);
            Place(st, rx, -106, 680, 30); st.text = "Before you start:"; st.color = new Color(0.82f, 0.84f, 0.62f);

            // Server + connection light (green = reachable, red = not)
            var s0 = MakeText(_menu, "s0", 18, TextAlignmentOptions.MidlineLeft); Place(s0, rx, -140, 90, 26); s0.text = "Server:";
            var lightGo = MakePanel(_menu, "ConnLight", new Color(0.8f, 0.25f, 0.2f));
            Place(lightGo, rx + 82, -142, 22, 22); _connLight = lightGo.GetComponent<Image>();
            _connText = MakeText(_menu, "ConnText", 17, TextAlignmentOptions.MidlineLeft);
            Place(_connText, rx + 114, -140, 560, 26); _connText.text = "checking…"; _connText.color = new Color(0.7f, 0.75f, 0.82f);
            var srvRow = MakeRow(_menu, rx, -170, 680, 56);
            MakeButton(srvRow, "Local server", new Color(0.2f, 0.3f, 0.36f), UseLocalServer);
            MakeButton(srvRow, "Dedicated server", new Color(0.24f, 0.26f, 0.42f), UseDedicatedServer);

            var b1 = MakeText(_menu, "b1", 18, TextAlignmentOptions.MidlineLeft); Place(b1, rx, -228, 680, 26);
            b1.text = "Who runs the 6 foxes:";
            var bRow = MakeRow(_menu, rx, -258, 680, 56);
            MakeButton(bRow, "Demo", new Color(0.2f, 0.3f, 0.3f), () => SelectBackend("demo"));
            MakeButton(bRow, "Claude key", new Color(0.28f, 0.22f, 0.42f), () => SelectBackend("api"));
            MakeButton(bRow, "Local agents", new Color(0.22f, 0.28f, 0.36f), () => SelectBackend("file"));

            var b2 = MakeText(_menu, "b2", 18, TextAlignmentOptions.MidlineLeft); Place(b2, rx, -316, 680, 26);
            b2.text = "Language:";
            var lRow = MakeRow(_menu, rx, -346, 680, 56);
            MakeButton(lRow, "Change language", new Color(0.2f, 0.28f, 0.34f), CycleLanguage);
            _langLabel = MakeText(lRow, "lang", 18, TextAlignmentOptions.MidlineLeft);
            _langLabel.gameObject.AddComponent<LayoutElement>().minWidth = 260;

            var b3 = MakeText(_menu, "b3", 18, TextAlignmentOptions.MidlineLeft); Place(b3, rx, -404, 680, 26);
            b3.text = "(optional) Paste API / voice key:";
            var kRow = MakeRow(_menu, rx, -434, 680, 56);
            MakeButton(kRow, "Paste key", new Color(0.16f, 0.3f, 0.45f), () => { PasteKey(); RefreshMenuStatus(); });
            MakeButton(kRow, "Forget", new Color(0.4f, 0.2f, 0.2f), () => { ApiKeyStore.Forget(); RefreshKeyStatus(); RefreshMenuStatus(); });

            _menuStatus = MakeText(_menu, "MenuStatus", 17, TextAlignmentOptions.TopLeft);
            Place(_menuStatus, rx, -498, 680, 70); _menuStatus.color = new Color(0.62f, 0.7f, 0.82f);

            var startRow = MakeRow(_menu, rx, -588, 680, 96);
            var start = MakeButton(startRow, "START  GAME", new Color(0.16f, 0.5f, 0.28f), StartFromMenu);
            var le = start.GetComponent<LayoutElement>(); le.minWidth = 420; le.minHeight = 82; le.preferredHeight = 82;
            var startLbl = start.GetComponentInChildren<TextMeshProUGUI>(); if (startLbl != null) startLbl.fontSize = 30;

            RefreshLangLabel();
            RefreshMenuStatus();
            SetConnected(client != null && client.Connected);
            _menu.gameObject.SetActive(true);
        }

        private void UseLocalServer()
        {
            if (client == null) return;
            client.UseLocal();
            if (_connLight != null) _connLight.color = new Color(0.85f, 0.7f, 0.2f); // amber while (re)connecting
            if (_connText != null) _connText.text = "connecting to local…";
        }

        private void UseDedicatedServer()
        {
            if (client == null) return;
            if (!client.UseDedicated())
            {
                if (_connLight != null) _connLight.color = new Color(0.8f, 0.25f, 0.2f);
                if (_connText != null) _connText.text = "dedicated server URL not set (fill dedicatedUrl on GameClient)";
                return;
            }
            if (_connLight != null) _connLight.color = new Color(0.85f, 0.7f, 0.2f);
            if (_connText != null) _connText.text = "connecting to dedicated…";
        }

        /// <summary>Connection indicator (called by GameDirector on SSE connect/disconnect).</summary>
        public void SetConnected(bool connected)
        {
            if (_connLight != null) _connLight.color = connected ? new Color(0.2f, 0.82f, 0.32f) : new Color(0.82f, 0.25f, 0.2f);
            if (_connText != null) _connText.text = connected
                ? "connected  (" + (client != null ? client.baseUrl : "") + ")"
                : "not reachable  (" + (client != null ? client.baseUrl : "") + ")";
        }

        private void CycleLanguage()
        {
            _langIndex = (_langIndex + 1) % Languages.Length;
            if (client != null) client.locale = Languages[_langIndex].code;
            RefreshLangLabel();
        }

        private void RefreshLangLabel()
        {
            if (_langLabel != null) _langLabel.text = "> " + Languages[_langIndex].label;
        }

        private void RefreshMenuStatus()
        {
            if (_menuStatus == null) return;
            string agent = ApiKeyStore.HasAgentKey ? $"Claude key: {ApiKeyStore.MaskedAgent()}" : "Claude key: not set";
            string voice = ApiKeyStore.HasVoiceKey ? $"Voice key: {ApiKeyStore.MaskedVoice()}" : "Voice key: off";
            _menuStatus.text = $"Backend: <b>{_backend}</b>\n{agent}  ·  {voice}\n(keys are kept in memory only, cleared on quit)";
        }

        private void StartFromMenu()
        {
            client?.SetBackend(_backend);
            if (_backend == "api" && !ApiKeyStore.HasAgentKey)
            {
                if (_menuStatus != null) _menuStatus.text = "The Claude backend needs a key — copy your sk-ant-… key, then Paste key.";
                return;
            }
            if (_menu != null) _menu.gameObject.SetActive(false);
            ShowThinking("Starting the game — waking the foxes");
            client?.NewGame();
        }

        public void OpenMenu() { if (_menu != null) { RefreshMenuStatus(); RefreshLangLabel(); _menu.gameObject.SetActive(true); } }

        // In-game control bar: reopen menu, quick restart, key controls.
        private void BuildControlBar(RectTransform crt)
        {
            var row = MakeRow(crt, 0, -672, 1400, 64);
            ((HorizontalLayoutGroup)row.GetComponent<HorizontalLayoutGroup>()).childAlignment = TextAnchor.MiddleCenter;
            MakeButton(row, "Menu", new Color(0.26f, 0.24f, 0.36f), OpenMenu);
            MakeButton(row, "New Game", new Color(0.16f, 0.4f, 0.26f), () => client?.NewGame());
            MakeButton(row, "Paste key", new Color(0.16f, 0.3f, 0.45f), PasteKey);
            MakeButton(row, "Forget", new Color(0.4f, 0.2f, 0.2f), () => { ApiKeyStore.Forget(); RefreshKeyStatus(); });

            _setupStatus = MakeText(crt, "SetupStatus", 17, TextAlignmentOptions.MidlineLeft);
            Place(_setupStatus, -358, -744, 700, 30); _setupStatus.color = new Color(0.62f, 0.7f, 0.82f);
            _keyStatus = MakeText(crt, "KeyStatus", 17, TextAlignmentOptions.MidlineLeft);
            Place(_keyStatus, 360, -744, 680, 30);
            RefreshKeyStatus();
        }

        private void SelectBackend(string b)
        {
            _backend = b;
            client?.SetBackend(b);
            RefreshMenuStatus();
        }

        private void PasteKey()
        {
            bool isAgent = ApiKeyStore.Set(GUIUtility.systemCopyBuffer);
            RefreshKeyStatus();
            if (_setupStatus != null)
                _setupStatus.text = isAgent ? "Claude key stored (memory only)." : "OpenAI voice key stored (memory only).";
        }

        private void RefreshKeyStatus()
        {
            if (_keyStatus == null) return;
            string agent = ApiKeyStore.HasAgentKey ? $"Claude: {ApiKeyStore.MaskedAgent()}" : "Claude: not set (sk-ant-…)";
            string voice = ApiKeyStore.HasVoiceKey ? $"Voice: {ApiKeyStore.MaskedVoice()}" : "Voice: off (sk-…)";
            _keyStatus.text = $"{agent}  ·  {voice}  ·  memory only";
        }

        // ── typed + voice input ─────────────────────────────────
        private void BuildTextRow(RectTransform crt)
        {
            _textRow = MakeRow(crt, 360, -446, 680, 66);
            _inputField = MakeInputField(_textRow, "Type your statement, then Send / Enter…");
            var le = _inputField.gameObject.AddComponent<LayoutElement>();
            le.minWidth = 360; le.flexibleWidth = 1f; le.minHeight = 54;
            MakeButton(_textRow, "Send", new Color(0.16f, 0.4f, 0.26f), SubmitTyped);
            if (speech != null) MakeButton(_textRow, "Talk (V)", new Color(0.45f, 0.2f, 0.36f), () => ToggleMic(_onSend));
            _textRow.gameObject.SetActive(false);
        }

        private void SubmitTyped()
        {
            if (_onSend == null) return;
            string t = _inputField != null ? _inputField.text : "";
            _onSend(t, _lean);
            if (_inputField != null) _inputField.text = "";
        }

        private void ToggleMic(Action<string, string> onSend)
        {
            if (speech == null || onSend == null) return;
            if (!_recording)
            {
                if (!speech.HasMic) { _instruction.text = "No microphone found."; return; }
                if (!ApiKeyStore.HasVoiceKey) { _instruction.text = "Paste an OpenAI voice key first (sk-…), then Talk."; return; }
                speech.StartRecording();
                _recording = true;
                _instruction.text = "● Recording… press Talk / V again to send.";
            }
            else
            {
                _recording = false;
                _instruction.text = "transcribing…";
                speech.StopAndTranscribe(text =>
                {
                    if (!string.IsNullOrEmpty(text)) onSend(text, _lean);
                    else _instruction.text = "Transcription failed — type instead or use a button.";
                });
            }
        }

        /// <summary>Animated "… is thinking" / loading cue shown during waits (see GameDirector).</summary>
        public void ShowThinking(string label)
        {
            _thinkingBase = string.IsNullOrEmpty(label) ? "thinking" : label;
            if (!_thinkingOn) { _thinkingOn = true; if (_thinking != null) _thinking.gameObject.SetActive(true); }
        }

        public void HideThinking()
        {
            if (!_thinkingOn) return;
            _thinkingOn = false;
            if (_thinking != null) _thinking.gameObject.SetActive(false);
        }

        private void Update()
        {
            if (_thinkingOn && _thinking != null)
            {
                int dots = 1 + Mathf.FloorToInt(Time.time * 2.5f) % 3;
                _thinking.text = _thinkingBase + new string('.', dots);
            }
            if (_textRow == null || !_textRow.gameObject.activeSelf || _onSend == null) return;
            if (_inputField != null && _inputField.isFocused) return;
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb != null && kb.vKey.wasPressedThisFrame) ToggleMic(_onSend);
        }

        // ── follow + scroll snap ────────────────────────────────
        private void LateUpdate()
        {
            if (_snapBottom && _transcriptScroll != null)
            {
                Canvas.ForceUpdateCanvases();
                _transcriptScroll.verticalNormalizedPosition = 0f;
                _snapBottom = false;
            }
            if (_canvas == null || anchor != null) return;
            var cam = Camera.main;
            if (cam == null) return;
            GetTargetPose(cam.transform, out var p, out var r);
            float k = 1f - Mathf.Exp(-followSpeed * Time.deltaTime);
            var t = _canvas.transform;
            t.position = Vector3.Lerp(t.position, p, k);
            t.rotation = Quaternion.Slerp(t.rotation, r, k);
        }

        public void PlaceInFront()
        {
            if (_canvas == null) return;
            var cam = Camera.main;
            if (cam == null) { _canvas.transform.position = new Vector3(0f, 0.6f, -1f); return; }
            GetTargetPose(cam.transform, out var p, out var r);
            _canvas.transform.SetPositionAndRotation(p, r);
        }

        private void GetTargetPose(Transform cam, out Vector3 pos, out Quaternion rot)
        {
            var flatFwd = Vector3.ProjectOnPlane(cam.forward, Vector3.up);
            if (flatFwd.sqrMagnitude < 1e-4f) flatFwd = cam.up;
            flatFwd.Normalize();
            pos = cam.position + flatFwd * followDist + Vector3.down * followDrop;
            rot = Quaternion.LookRotation(pos - cam.position, Vector3.up);
        }

        // ── director-facing API ─────────────────────────────────
        public void SetStatus(string s) { if (_status) _status.text = s; }
        public void SetNotes(string s) { if (_notes) _notes.text = s; }
        public void ResetTranscript() { _lines.Clear(); if (_transcript) _transcript.text = ""; }

        public void AppendLine(string who, string text, string hexColor)
        {
            bool atBottom = _transcriptScroll == null || _transcriptScroll.verticalNormalizedPosition <= 0.06f;
            string prefix = string.IsNullOrEmpty(who) ? "" : $"<b>{who}:</b> ";
            _lines.Add($"<color={hexColor}>{prefix}{Escape(text)}</color>");
            while (_lines.Count > maxTranscriptLines) _lines.RemoveAt(0);
            if (_transcript) _transcript.text = string.Join("\n", _lines);
            if (atBottom) _snapBottom = true; // keep the latest visible unless the user scrolled up
        }

        public void ShowTargets(string instruction, IList<string> targets, bool canAbstain, Action<string> onPick)
        {
            _instruction.text = instruction;
            _onSend = null;
            if (_textRow != null) _textRow.gameObject.SetActive(false);
            ClearRow();
            foreach (var t in targets) { var id = t; MakeButton(_inputRow, id, new Color(0.16f, 0.3f, 0.45f), () => onPick(id)); }
            if (canAbstain) MakeButton(_inputRow, "abstain", new Color(0.3f, 0.3f, 0.3f), () => onPick("abstain"));
        }

        public void ShowSpeech(string instruction, bool isOpening, IList<string> leanTargets, Action<string, string> onSend)
        {
            _instruction.text = instruction;
            _onSend = onSend;
            _lean = "abstain";
            if (_textRow != null) _textRow.gameObject.SetActive(true);
            ClearRow();
            if (isOpening && leanTargets != null)
            {
                MakeButton(_inputRow, "lean:—", new Color(0.25f, 0.2f, 0.3f), null);
                foreach (var t in leanTargets) { var id = t; MakeButton(_inputRow, id, new Color(0.28f, 0.22f, 0.4f), () => _lean = id); }
            }
            foreach (var phrase in QuickPhrases)
            {
                var p = phrase;
                MakeButton(_inputRow, Shorten(p), new Color(0.16f, 0.32f, 0.24f), () => onSend(p, _lean));
            }
            MakeButton(_inputRow, "Pass", new Color(0.3f, 0.3f, 0.3f), () => onSend("", _lean));
        }

        public void HideInput()
        {
            if (_instruction) _instruction.text = "";
            _onSend = null;
            if (_textRow != null) _textRow.gameObject.SetActive(false);
            ClearRow();
        }

        // ── uGUI construction helpers ───────────────────────────
        private void ClearRow()
        {
            if (_inputRow == null) return;
            for (int i = _inputRow.childCount - 1; i >= 0; i--) Destroy(_inputRow.GetChild(i).gameObject);
        }

        // Vertical ScrollRect wrapping a TMP text; returns the ScrollRect, out the text.
        private ScrollRect BuildScroll(RectTransform parent, float x, float y, float w, float h, float fontSize, out TextMeshProUGUI text)
        {
            var scrollGo = new GameObject("Scroll", typeof(RectTransform), typeof(ScrollRect));
            scrollGo.transform.SetParent(parent, false);
            Place((RectTransform)scrollGo.transform, x, y, w, h);
            var sr = scrollGo.GetComponent<ScrollRect>();
            sr.horizontal = false; sr.vertical = true;
            sr.movementType = ScrollRect.MovementType.Clamped;
            sr.scrollSensitivity = 28f;

            var vpGo = new GameObject("Viewport", typeof(RectTransform), typeof(RectMask2D), typeof(Image));
            vpGo.transform.SetParent(scrollGo.transform, false);
            var vp = (RectTransform)vpGo.transform;
            vp.anchorMin = Vector2.zero; vp.anchorMax = Vector2.one; vp.pivot = new Vector2(0f, 1f);
            vp.offsetMin = new Vector2(0, 0); vp.offsetMax = new Vector2(-16, 0);
            vpGo.GetComponent<Image>().color = new Color(0, 0, 0, 0.12f);

            text = MakeText(vp, "Content", fontSize, TextAlignmentOptions.TopLeft);
            var content = (RectTransform)text.transform;
            content.anchorMin = new Vector2(0, 1); content.anchorMax = new Vector2(1, 1); content.pivot = new Vector2(0.5f, 1f);
            content.offsetMin = new Vector2(8, 0); content.offsetMax = new Vector2(-8, 0);
            content.sizeDelta = new Vector2(0, 0);
            text.textWrappingMode = TextWrappingModes.Normal;
            var fitter = text.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            var sbGo = new GameObject("Scrollbar", typeof(RectTransform), typeof(Image), typeof(Scrollbar));
            sbGo.transform.SetParent(scrollGo.transform, false);
            var sbRt = (RectTransform)sbGo.transform;
            sbRt.anchorMin = new Vector2(1, 0); sbRt.anchorMax = new Vector2(1, 1); sbRt.pivot = new Vector2(1, 0.5f);
            sbRt.sizeDelta = new Vector2(14, 0); sbRt.anchoredPosition = Vector2.zero;
            sbGo.GetComponent<Image>().color = new Color(0.15f, 0.17f, 0.22f, 0.6f);
            var sb = sbGo.GetComponent<Scrollbar>();
            sb.direction = Scrollbar.Direction.BottomToTop;
            var handleGo = new GameObject("Handle", typeof(RectTransform), typeof(Image));
            handleGo.transform.SetParent(sbGo.transform, false);
            var handleRt = (RectTransform)handleGo.transform;
            handleRt.anchorMin = Vector2.zero; handleRt.anchorMax = Vector2.one; handleRt.sizeDelta = Vector2.zero;
            handleGo.GetComponent<Image>().color = new Color(0.5f, 0.55f, 0.65f, 0.85f);
            sb.handleRect = handleRt; sb.targetGraphic = handleGo.GetComponent<Image>();

            sr.viewport = vp; sr.content = content; sr.verticalScrollbar = sb;
            sr.verticalScrollbarVisibility = ScrollRect.ScrollbarVisibility.Permanent;
            return sr;
        }

        private RectTransform MakeRow(RectTransform parent, float x, float y, float w, float h)
        {
            var go = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            go.transform.SetParent(parent, false);
            var rt = (RectTransform)go.transform;
            Place(rt, x, y, w, h);
            var hlg = go.GetComponent<HorizontalLayoutGroup>();
            hlg.spacing = 8; hlg.childAlignment = TextAnchor.MiddleLeft;
            hlg.childForceExpandWidth = false; hlg.childForceExpandHeight = true;
            hlg.padding = new RectOffset(6, 6, 6, 6);
            return rt;
        }

        private static RectTransform MakePanel(RectTransform parent, string name, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            go.GetComponent<Image>().color = color;
            return (RectTransform)go.transform;
        }

        private static TextMeshProUGUI MakeText(RectTransform parent, string name, float size, TextAlignmentOptions align)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<TextMeshProUGUI>();
            t.fontSize = size; t.alignment = align; t.color = Color.white; t.richText = true;
            return t;
        }

        private TMP_InputField MakeInputField(RectTransform parent, string placeholder)
        {
            var go = new GameObject("InputField", typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            go.GetComponent<Image>().color = new Color(0.1f, 0.13f, 0.18f, 0.95f);
            var field = go.AddComponent<TMP_InputField>();

            var area = new GameObject("TextArea", typeof(RectTransform), typeof(RectMask2D));
            area.transform.SetParent(go.transform, false);
            Stretch((RectTransform)area.transform, 12, 6, 12, 6);

            var ph = new GameObject("Placeholder", typeof(RectTransform)).AddComponent<TextMeshProUGUI>();
            ph.transform.SetParent(area.transform, false);
            ph.text = placeholder; ph.fontSize = 18; ph.color = new Color(1f, 1f, 1f, 0.4f);
            ph.alignment = TextAlignmentOptions.MidlineLeft; ph.textWrappingMode = TextWrappingModes.NoWrap;
            Stretch((RectTransform)ph.transform, 0, 0, 0, 0);

            var txt = new GameObject("Text", typeof(RectTransform)).AddComponent<TextMeshProUGUI>();
            txt.transform.SetParent(area.transform, false);
            txt.fontSize = 18; txt.color = Color.white;
            txt.alignment = TextAlignmentOptions.MidlineLeft; txt.textWrappingMode = TextWrappingModes.NoWrap;
            Stretch((RectTransform)txt.transform, 0, 0, 0, 0);

            field.textViewport = (RectTransform)area.transform;
            field.textComponent = txt;
            field.placeholder = ph;
            field.lineType = TMP_InputField.LineType.SingleLine;
            field.onSubmit.AddListener(_ => SubmitTyped());
            return field;
        }

        private GameObject MakeButton(RectTransform parent, string label, Color color, Action onClick)
        {
            var go = new GameObject("Btn_" + label, typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(parent, false);
            go.GetComponent<Image>().color = color;
            var le = go.AddComponent<LayoutElement>();
            le.minWidth = 88; le.minHeight = 54; le.preferredHeight = 54;
            var lblGo = new GameObject("Label", typeof(RectTransform));
            lblGo.transform.SetParent(go.transform, false);
            var lbl = lblGo.AddComponent<TextMeshProUGUI>();
            lbl.text = label; lbl.fontSize = 17; lbl.alignment = TextAlignmentOptions.Center; lbl.color = Color.white;
            lbl.textWrappingMode = TextWrappingModes.Normal;
            Stretch((RectTransform)lblGo.transform, 4, 4, 4, 4);
            var btn = go.GetComponent<Button>();
            if (onClick != null) btn.onClick.AddListener(() => onClick());
            else btn.interactable = false;
            return go;
        }

        private static void Place(TextMeshProUGUI t, float x, float y, float w, float h) => Place((RectTransform)t.transform, x, y, w, h);
        private static void Place(RectTransform rt, float x, float y, float w, float h)
        {
            rt.anchorMin = new Vector2(0.5f, 1f); rt.anchorMax = new Vector2(0.5f, 1f);
            rt.pivot = new Vector2(0.5f, 1f);
            rt.sizeDelta = new Vector2(w, h);
            rt.anchoredPosition = new Vector2(x, y);
        }

        private static void Stretch(RectTransform rt, float l, float t, float r, float b)
        {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.pivot = new Vector2(0.5f, 0.5f);
            rt.offsetMin = new Vector2(l, b); rt.offsetMax = new Vector2(-r, -t);
        }

        private static void AddVrRaycaster(GameObject canvasGo)
        {
            var type = Type.GetType("UnityEngine.XR.Interaction.Toolkit.UI.TrackedDeviceGraphicRaycaster, Unity.XR.Interaction.Toolkit");
            if (type != null && canvasGo.GetComponent(type) == null) canvasGo.AddComponent(type);
        }

        private void EnsureEventSystem()
        {
            if (FindFirstObjectByType<EventSystem>() != null) return;
            var go = new GameObject("EventSystem", typeof(EventSystem));
            go.AddComponent<InputSystemUIInputModule>();
        }

        private static string Shorten(string s) => s.Length <= 14 ? s : s.Substring(0, 13) + "…";
        private static string Escape(string s) => s.Replace("<", "‹").Replace(">", "›");
    }
}
