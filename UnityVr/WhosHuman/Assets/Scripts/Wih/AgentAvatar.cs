using System;
using TMPro;
using UnityEngine;

namespace Wih
{
    /// <summary>
    /// One seated agent. Handles the nameplate, per-agent color (via the
    /// Wih/AgentScarf shader's _ScarfColor if present, else _BaseColor), the
    /// emissive "speaking" pulse, alive/dead state, spatial TTS playback, an
    /// optional AgentAnimator (idle/talk), and mouse click-to-vote in the editor.
    /// Works on a skinned character or a primitive.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public class AgentAvatar : MonoBehaviour
    {
        public string id = "A-01";
        public string displayName = ""; // e.g. "Red Fox" — shown on the nameplate
        public Color baseColor = Color.white;

        private string NameLabel => string.IsNullOrEmpty(displayName) ? id : displayName;
        // Brightened agent colour — a clear per-fox identifier on the nameplate (works
        // regardless of the scarf-mask UVs).
        private Color NameColor => Color.Lerp(baseColor, Color.white, 0.35f);

        [Header("Optional (auto-found/created if null)")]
        public Renderer targetRenderer;
        public TextMeshPro nameplate;
        public AudioSource audioSource;
        public AgentAnimator animator;
        public FaceController face;
        public Transform headAnchor;                 // the Head bone — where others aim their gaze
        public float nameplateHeight = 0.85f;

        /// <summary>Point other foxes look at (head height), falling back to the root.</summary>
        public Transform LookPoint => headAnchor != null ? headAnchor : transform;

        public event Action<string> Clicked;
        public bool IsTargetable { get; private set; }

        private MaterialPropertyBlock _mpb; // lazily created (can't `new` it in a field initializer)
        private bool _useScarf;
        private bool _speaking;
        private bool _alive = true;
        private bool _inited;
        private float _pulse;

        // Procedural life (works on a static/unrigged mesh): idle breathing bob +
        // gentle sway, a bigger bounce + forward lean while speaking, and a partial
        // turn toward whoever is currently talking.
        [Header("Procedural motion")]
        public bool proceduralMotion = true;
        public float idleBob = 0.02f, speakBob = 0.05f, swayDeg = 1.6f, leanDeg = 4f, nodDeg = 7f;
        public float deadTiltDeg = 85f, deadDrop = 0.12f;   // tip over + settle when killed
        private Vector3 _homePos;
        private Quaternion _homeRot;
        private float _phase;
        private Transform _lookTarget;
        private bool _dead;
        private Animator _unityAnim;

        private static readonly int ScarfColorId = Shader.PropertyToID("_ScarfColor");
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");

        private void Awake()
        {
            if (!_inited) Init(id, baseColor);
        }

        public void Init(string agentId, Color color)
        {
            _inited = true;
            id = agentId;
            baseColor = color;

            audioSource = GetComponent<AudioSource>();
            audioSource.spatialBlend = 1f;
            audioSource.playOnAwake = false;
            audioSource.dopplerLevel = 0f;
            audioSource.minDistance = 1.2f;
            audioSource.maxDistance = 12f;

            // Prefer the body's SkinnedMeshRenderer (the scarf material + speaking glow
            // belong on the body, not on a tiny eye-disc MeshRenderer).
            if (targetRenderer == null) targetRenderer = GetComponentInChildren<SkinnedMeshRenderer>();
            if (targetRenderer == null) targetRenderer = GetComponentInChildren<Renderer>();
            // Don't let the body get frustum-culled when it tips over on death.
            if (targetRenderer is SkinnedMeshRenderer bodySmr) bodySmr.updateWhenOffscreen = true;
            _unityAnim = GetComponentInChildren<Animator>();
            if (animator == null) animator = GetComponentInChildren<AgentAnimator>();
            if (face == null) face = GetComponentInChildren<FaceController>();
            if (face != null && face.voice == null) face.voice = audioSource; // lip-sync to TTS
            _useScarf = targetRenderer != null && targetRenderer.sharedMaterial != null &&
                        targetRenderer.sharedMaterial.HasProperty(ScarfColorId);

            ApplyColor(baseColor);
            EnsureCollider();
            EnsureNameplate();

            _homePos = transform.localPosition;
            _homeRot = transform.localRotation;
            _phase = UnityEngine.Random.value * 6.2831853f;
        }

        /// <summary>Turn partially toward a transform (e.g. the current speaker); null = face home.
        /// Also drives the eyes (FaceController) so the fox actually looks at the speaker.</summary>
        public void SetLookTarget(Transform t)
        {
            _lookTarget = t;
            if (face != null) face.SetLookTarget(t);
        }

        // ── color / emission (per-renderer, via property block) ──
        private void ApplyColor(Color c)
        {
            if (targetRenderer == null) return;
            if (_mpb == null) _mpb = new MaterialPropertyBlock();
            targetRenderer.GetPropertyBlock(_mpb);
            _mpb.SetColor(_useScarf ? ScarfColorId : BaseColorId, c);
            targetRenderer.SetPropertyBlock(_mpb);
        }

        private void SetEmission(Color e)
        {
            if (targetRenderer == null) return;
            if (_mpb == null) _mpb = new MaterialPropertyBlock();
            targetRenderer.GetPropertyBlock(_mpb);
            _mpb.SetColor(EmissionColorId, e);
            targetRenderer.SetPropertyBlock(_mpb);
        }

        public void SetSpeaking(bool on)
        {
            _speaking = on && _alive;
            if (!_speaking) SetEmission(Color.black);
            if (animator != null) animator.SetSpeaking(_speaking);
            if (face != null) face.SetSpeaking(_speaking);
        }

        public void SetTargetable(bool on)
        {
            IsTargetable = on;
            if (nameplate != null) nameplate.color = on ? new Color(1f, 0.82f, 0.4f) : NameColor;
        }

        public void SetAlive(bool alive)
        {
            _alive = alive;
            _dead = !alive;
            if (!alive)
            {
                SetSpeaking(false);
                ApplyColor(Color.Lerp(baseColor, Color.gray, 0.7f));
                if (nameplate != null) nameplate.color = new Color(0.5f, 0.5f, 0.5f);
                if (animator != null) animator.SetAlive(false);
                if (_unityAnim != null) _unityAnim.enabled = false; // freeze the body so it lies still
                if (face != null) face.enabled = false;             // stop blinking/twitching
            }
            else
            {
                ApplyColor(baseColor);
                if (animator != null) animator.SetAlive(true);
                if (_unityAnim != null) _unityAnim.enabled = true;
                if (face != null) face.enabled = true;
            }
        }

        public void ShowRevealed(string roleLabel)
        {
            if (nameplate != null) nameplate.text = $"{NameLabel}\n<size=60%>{roleLabel}</size>";
        }

        public void PlayClip(AudioClip clip)
        {
            if (clip == null || audioSource == null) return;
            audioSource.Stop();
            audioSource.clip = clip;
            audioSource.Play();
        }

        /// <summary>Cut off any TTS mid-sentence (used on New Game).</summary>
        public void StopVoice() { if (audioSource != null) audioSource.Stop(); }

        // Full reset for a new game: alive, un-hidden (reverses SetHiddenAsHuman on the
        // PREVIOUS human's fox), standing at home, colours + face + animator back.
        public void ResetVisual()
        {
            _alive = true;
            _dead = false;
            SetSpeaking(false);
            SetTargetable(false);
            ApplyColor(baseColor);

            foreach (var r in GetComponentsInChildren<Renderer>(true)) r.enabled = true; // un-hide
            var col = GetComponent<Collider>(); if (col != null) col.enabled = true;
            proceduralMotion = true;
            _lookTarget = null;
            transform.localPosition = _homePos;   // un-tip any dead pose
            transform.localRotation = _homeRot;

            if (nameplate != null) { nameplate.enabled = true; nameplate.text = NameLabel; nameplate.color = NameColor; }
            if (animator != null) animator.SetAlive(true);
            if (_unityAnim != null) _unityAnim.enabled = true; // stand back up
            if (face != null) face.enabled = true;
        }

        /// <summary>This fox is the human's own seat: make it invisible + non-interactive
        /// (the player's camera sits here). The transform stays as the seat reference.</summary>
        public void SetHiddenAsHuman()
        {
            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = false;
            if (nameplate != null) nameplate.enabled = false;
            var col = GetComponent<Collider>(); if (col != null) col.enabled = false;
            proceduralMotion = false;
        }

        private void Update()
        {
            if (_speaking)
            {
                _pulse += Time.deltaTime * 6f;
                float k = 0.5f + 0.5f * Mathf.Sin(_pulse);
                SetEmission(baseColor * (0.25f + 1.2f * k));
            }
            if (proceduralMotion && _alive) ProceduralMotion();
            else if (_dead) DeadPose();
            if (nameplate != null && Camera.main != null)
                nameplate.transform.rotation = Quaternion.LookRotation(nameplate.transform.position - Camera.main.transform.position);
        }

        private void ProceduralMotion()
        {
            float t = Time.time;
            float speed = _speaking ? 5.5f : 1.4f;
            float bobAmp = _speaking ? speakBob : idleBob;
            float bob = Mathf.Sin(t * speed + _phase) * bobAmp;
            transform.localPosition = _homePos + Vector3.up * bob;

            // base rotation: home, or a partial turn toward the current speaker
            Quaternion baseRot = _homeRot;
            if (_lookTarget != null)
            {
                Vector3 to = _lookTarget.position - transform.position; to.y = 0f;
                if (to.sqrMagnitude > 1e-4f)
                    baseRot = Quaternion.Slerp(_homeRot, Quaternion.LookRotation(to.normalized, Vector3.up), 0.35f);
            }
            // While speaking: nod (rhythmic pitch) + more sway.
            float nod = _speaking ? Mathf.Sin(t * 5.5f + _phase) * nodDeg : 0f;
            float swayMul = _speaking ? 2.2f : 1f;
            float pitch = (_speaking ? leanDeg : 0f) + nod + Mathf.Sin(t * speed * 0.9f + _phase) * swayDeg;
            float yaw = Mathf.Sin(t * (speed * 0.6f) + _phase * 1.3f) * swayDeg * swayMul;
            transform.localRotation = baseRot * Quaternion.Euler(pitch, yaw, 0f);
        }

        // Killed foxes tip over and settle (lie down).
        private void DeadPose()
        {
            float k = 1f - Mathf.Exp(-6f * Time.deltaTime);
            Quaternion prone = _homeRot * Quaternion.Euler(deadTiltDeg, 0f, 0f);
            transform.localRotation = Quaternion.Slerp(transform.localRotation, prone, k);
            transform.localPosition = Vector3.Lerp(transform.localPosition, _homePos + Vector3.down * deadDrop, k);
        }

        private void EnsureCollider()
        {
            if (GetComponent<Collider>() != null) return;
            var bc = gameObject.AddComponent<BoxCollider>();
            if (targetRenderer != null)
            {
                var b = targetRenderer.bounds;
                bc.center = transform.InverseTransformPoint(b.center);
                bc.size = new Vector3(0.5f, Mathf.Max(0.6f, b.size.y), 0.5f);
            }
            else { bc.center = new Vector3(0, 0.5f, 0); bc.size = new Vector3(0.5f, 1f, 0.5f); }
        }

        private void EnsureNameplate()
        {
            if (nameplate == null)
            {
                var go = new GameObject("Nameplate");
                go.transform.SetParent(transform, false);
                go.transform.localPosition = new Vector3(0, nameplateHeight, 0);
                nameplate = go.AddComponent<TextMeshPro>();
                nameplate.fontSize = 2.2f;
                nameplate.alignment = TextAlignmentOptions.Center;
                var rt = nameplate.GetComponent<RectTransform>();
                rt.sizeDelta = new Vector2(2f, 0.5f);
            }
            nameplate.text = NameLabel;
            nameplate.color = NameColor;
        }

        private void OnMouseDown() => Clicked?.Invoke(id);
    }
}
