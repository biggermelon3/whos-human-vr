using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Procedural FACE layer, independent of the body Animator. Runs in LateUpdate
    /// (after the Animator), so it overrides just the face bones/blend-shapes while
    /// the body plays Idle/Talk/etc. — no avatar mask, no separate face mesh needed.
    ///  • Eyes: rotate eye bones for idle saccades or to look at a target.
    ///  • Blink: a blend shape, periodically.
    ///  • Mouth: a jaw bone AND/OR a blend shape, opened by the TTS audio amplitude
    ///    while speaking (rough lip-sync), with a fallback wobble.
    /// Assign whatever your rig has — every field is optional. AgentAvatar wires
    /// SetSpeaking() and the voice source automatically.
    /// </summary>
    public class FaceController : MonoBehaviour
    {
        [Header("Eyes (bones, optional)")]
        public Transform leftEye;
        public Transform rightEye;
        public float eyeYawRange = 16f;
        public float eyePitchRange = 9f;
        public Transform lookTarget; // if set, eyes track it; else random saccades

        [Header("Blend shapes (optional)")]
        public SkinnedMeshRenderer faceMesh;
        public string blinkShape = "";  // e.g. "Blink"
        public string mouthShape = "";  // e.g. "MouthOpen"
        public float blinkEveryMin = 2.5f;
        public float blinkEveryMax = 6f;
        public float blinkDuration = 0.12f;

        [Header("Mouth (lower-lip / jaw bone) — rest pose is OPEN, so speaking CLOSES it")]
        public Transform jawBone;
        // Measured on A-02's LowerLip: open≈(y -0.09, z -0.07) → closed (y -0.02, z -0.10),
        // i.e. a local delta of (0, +0.07, -0.03). Full close moves the lip by this.
        public Vector3 jawCloseMove = new Vector3(0f, 0.07f, -0.03f);
        public Vector3 jawCloseEuler = new Vector3(0f, 0f, 0f);      // optional rotation toward closed
        public float mouthMax = 1f;
        public float mouthSmooth = 18f;        // light smoothing (kills the jitter but still visibly moves)
        public float talkMouthSpeed = 11f;     // flap rate when no TTS audio
        public float idleMouthSpeed = 2.3f;    // gentle breathing rate when NOT speaking
        [Range(0f, 1f)] public float idleMouthAmp = 0.2f;   // idle open/close amount
        [Range(0f, 1f)] public float idleMouthMid = 0.72f;  // idle mid openness (1 = fully open/rest)

        [Header("Ears (bones, optional)")]
        public Transform leftEar;
        public Transform rightEar;
        public float earTwitchEvery = 3.5f;  // seconds between idle twitches
        public float earTwitchDeg = 20f;     // twitch amplitude (bigger)
        public float earPerkDeg = 13f;       // perk up while speaking

        [Header("Nose (bone, optional) — occasional twitch by TRANSLATION")]
        public Transform noseBone;
        public float noseTwitchEvery = 5f;                          // seconds between nose twitches
        public Vector3 noseTwitchMove = new Vector3(0f, 0.006f, 0f); // small local wiggle

        [Header("Voice source (auto-set by AgentAvatar)")]
        public AudioSource voice;

        private bool _speaking;
        private float _nextBlink, _blinkT, _nextSaccade;
        private Vector2 _eyeTarget, _eyeCur;
        private Quaternion _leftRest, _rightRest, _jawRest, _leftEarRest, _rightEarRest;
        private Vector3 _jawRestPos, _noseRestPos;
        private int _blinkIdx = -1, _mouthIdx = -1;
        private float _nextTwitch, _twitchT, _nextNoseTwitch, _noseTwitchT;
        private float _mouthOpen = 1f; // smoothed openness (1 = open/rest)
        private readonly float[] _samples = new float[256];

        private void Awake()
        {
            if (leftEye) _leftRest = leftEye.localRotation;
            if (rightEye) _rightRest = rightEye.localRotation;
            if (jawBone) { _jawRest = jawBone.localRotation; _jawRestPos = jawBone.localPosition; }
            if (leftEar) _leftEarRest = leftEar.localRotation;
            if (rightEar) _rightEarRest = rightEar.localRotation;
            if (noseBone) _noseRestPos = noseBone.localPosition;
            if (faceMesh && faceMesh.sharedMesh)
            {
                if (!string.IsNullOrEmpty(blinkShape)) _blinkIdx = faceMesh.sharedMesh.GetBlendShapeIndex(blinkShape);
                if (!string.IsNullOrEmpty(mouthShape)) _mouthIdx = faceMesh.sharedMesh.GetBlendShapeIndex(mouthShape);
            }
            ScheduleBlink();
            ScheduleSaccade();
        }

        public void SetSpeaking(bool on) => _speaking = on;
        public void SetLookTarget(Transform t) => lookTarget = t;

        private void LateUpdate()
        {
            float dt = Mathf.Max(Time.deltaTime, 1e-4f);

            // ── eyes ──
            if (leftEye || rightEye)
            {
                Vector2 want;
                if (lookTarget)
                {
                    var pivot = (leftEye ? leftEye : rightEye);
                    var dir = transform.InverseTransformDirection((lookTarget.position - pivot.position).normalized);
                    float yaw = Mathf.Clamp(Mathf.Atan2(dir.x, Mathf.Max(0.01f, dir.z)) * Mathf.Rad2Deg, -eyeYawRange, eyeYawRange);
                    float pitch = Mathf.Clamp(Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude) * Mathf.Rad2Deg, -eyePitchRange, eyePitchRange);
                    want = new Vector2(yaw, pitch);
                }
                else
                {
                    if (Time.time > _nextSaccade)
                    {
                        _eyeTarget = new Vector2(Random.Range(-1f, 1f) * eyeYawRange, Random.Range(-1f, 1f) * eyePitchRange);
                        ScheduleSaccade();
                    }
                    want = _eyeTarget;
                }
                _eyeCur = Vector2.Lerp(_eyeCur, want, 1f - Mathf.Exp(-14f * dt));
                var rot = Quaternion.Euler(-_eyeCur.y, _eyeCur.x, 0f);
                if (leftEye) leftEye.localRotation = _leftRest * rot;
                if (rightEye) rightEye.localRotation = _rightRest * rot;
            }

            // ── blink ──
            if (_blinkIdx >= 0)
            {
                if (Time.time > _nextBlink) { _blinkT = blinkDuration; ScheduleBlink(); }
                float w = _blinkT > 0f ? Mathf.Sin((1f - _blinkT / blinkDuration) * Mathf.PI) : 0f;
                faceMesh.SetBlendShapeWeight(_blinkIdx, Mathf.Clamp01(w) * 100f);
                if (_blinkT > 0f) _blinkT -= dt;
            }

            // ── mouth ── rest pose is OPEN (openness 1 = open, 0 = closed). Speaking
            // flaps the full range (visible); idle gently breathes so it's never static.
            float target;
            if (_speaking)
            {
                if (voice && voice.isPlaying)
                {
                    voice.GetOutputData(_samples, 0);
                    float rms = 0f;
                    for (int i = 0; i < _samples.Length; i++) rms += _samples[i] * _samples[i];
                    target = Mathf.Clamp01(Mathf.Sqrt(rms / _samples.Length) * 9f);
                }
                else target = 0.5f + 0.5f * Mathf.Sin(Time.time * talkMouthSpeed); // no audio → flap
            }
            else
            {
                target = idleMouthMid + idleMouthAmp * Mathf.Sin(Time.time * idleMouthSpeed); // gentle idle
            }
            _mouthOpen = Mathf.Lerp(_mouthOpen, Mathf.Clamp01(target), 1f - Mathf.Exp(-mouthSmooth * dt));
            float close = (1f - _mouthOpen) * mouthMax;
            if (_mouthIdx >= 0) faceMesh.SetBlendShapeWeight(_mouthIdx, _mouthOpen * mouthMax * 100f);
            if (jawBone)
            {
                jawBone.localRotation = _jawRest * Quaternion.Euler(jawCloseEuler * close);
                jawBone.localPosition = _jawRestPos + jawCloseMove * close; // lower lip moves up to close
            }

            // ── ears: idle twitch + perk while speaking ──
            if (leftEar || rightEar)
            {
                if (Time.time > _nextTwitch) { _twitchT = 0.25f; _nextTwitch = Time.time + Random.Range(earTwitchEvery * 0.6f, earTwitchEvery * 1.4f); }
                float tw = _twitchT > 0f ? Mathf.Sin((1f - _twitchT / 0.25f) * Mathf.PI) * earTwitchDeg : 0f;
                float perk = _speaking ? earPerkDeg : 0f;
                if (leftEar) leftEar.localRotation = _leftEarRest * Quaternion.Euler(-(perk + tw), 0f, 0f);
                if (rightEar) rightEar.localRotation = _rightEarRest * Quaternion.Euler(-(perk + tw * 0.7f), 0f, 0f);
                if (_twitchT > 0f) _twitchT -= dt;
            }

            // ── nose: occasional twitch by translation ──
            if (noseBone)
            {
                if (Time.time > _nextNoseTwitch) { _noseTwitchT = 0.3f; _nextNoseTwitch = Time.time + Random.Range(noseTwitchEvery * 0.6f, noseTwitchEvery * 1.4f); }
                float nt = _noseTwitchT > 0f ? Mathf.Sin((1f - _noseTwitchT / 0.3f) * Mathf.PI) : 0f; // 0→1→0
                noseBone.localPosition = _noseRestPos + noseTwitchMove * nt;
                if (_noseTwitchT > 0f) _noseTwitchT -= dt;
            }
        }

        private void ScheduleBlink() => _nextBlink = Time.time + Random.Range(blinkEveryMin, blinkEveryMax);
        private void ScheduleSaccade() => _nextSaccade = Time.time + Random.Range(0.8f, 2.6f);
    }
}
