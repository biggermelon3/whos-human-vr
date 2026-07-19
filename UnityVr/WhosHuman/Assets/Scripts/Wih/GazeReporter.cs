using System.Collections.Generic;
using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Watches where the human (camera) is looking and periodically tells the server
    /// which agent they've been staring at. The server turns that into a subtle
    /// behavioral "tell" the AI foxes can read (see /api/observe). Uses a simple
    /// angle cone — no colliders needed — and skips the human's own (hidden) fox.
    /// </summary>
    public class GazeReporter : MonoBehaviour
    {
        public GameClient client;
        [Tooltip("Set by GameDirector on game_start — the human's own fox is ignored.")]
        public string humanId = "";
        public float reportInterval = 1.5f;   // how often to POST
        public float coneDegrees = 22f;        // how tight a look counts as "at" an agent
        public float headHeight = 0.8f;        // aim point above the agent's origin
        public float minDwellToReport = 0.6f;  // seconds within the window before we bother reporting

        private readonly Dictionary<string, float> _dwell = new Dictionary<string, float>();
        private AgentAvatar[] _avatars;
        private Transform _cam;
        private float _timer;

        private void Start() => Refresh();

        /// <summary>Re-scan avatars (call after a scene/roster change).</summary>
        public void Refresh()
        {
            _avatars = FindObjectsByType<AgentAvatar>(FindObjectsSortMode.None);
            if (Camera.main != null) _cam = Camera.main.transform;
        }

        private void Update()
        {
            if (client == null) return;
            if (_cam == null) { if (Camera.main != null) _cam = Camera.main.transform; else return; }
            if (_avatars == null || _avatars.Length == 0) { Refresh(); return; }

            // Which agent is closest to the center of gaze this frame?
            string looked = null;
            float best = coneDegrees;
            foreach (var a in _avatars)
            {
                if (a == null || !a.gameObject.activeInHierarchy) continue; // hidden human fox = inactive
                if (!string.IsNullOrEmpty(humanId) && a.id == humanId) continue;
                Vector3 dir = (a.transform.position + Vector3.up * headHeight) - _cam.position;
                float ang = Vector3.Angle(_cam.forward, dir);
                if (ang < best) { best = ang; looked = a.id; }
            }
            if (looked != null)
                _dwell[looked] = (_dwell.TryGetValue(looked, out var d) ? d : 0f) + Time.deltaTime;

            _timer += Time.deltaTime;
            if (_timer < reportInterval) return;
            _timer = 0f;

            // Report the agent that held the most attention this window, then reset.
            string top = null; float topDwell = 0f;
            foreach (var kv in _dwell) if (kv.Value > topDwell) { topDwell = kv.Value; top = kv.Key; }
            _dwell.Clear();
            if (top != null && topDwell >= minDwellToReport)
                client.ReportGaze(top, Mathf.RoundToInt(topDwell * 1000f));
        }
    }
}
