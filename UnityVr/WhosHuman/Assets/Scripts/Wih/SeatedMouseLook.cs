using UnityEngine;
using UnityEngine.InputSystem;

namespace Wih
{
    /// <summary>
    /// Editor/desktop test helper: lets you look around with the mouse when no VR
    /// headset is active (seated — no walking). Hold RIGHT mouse button and drag to
    /// look; left-click stays free for selecting agents / UI. Auto-disables itself
    /// when a real XR HMD is present, so it never fights head tracking in VR.
    /// Attach to the Main Camera.
    /// </summary>
    public class SeatedMouseLook : MonoBehaviour
    {
        public float sensitivity = 0.12f;
        public bool holdRightMouseToLook = true;

        private float _yaw, _pitch;
        private bool _active;

        private void Start()
        {
            _active = !UnityEngine.XR.XRSettings.isDeviceActive; // no HMD → we drive the view
            if (!_active) return;

            var e = transform.localEulerAngles;
            _yaw = e.y;
            _pitch = NormalizePitch(e.x);

            // Stop the XR tracked-pose driver from resetting our rotation each frame.
            foreach (var b in GetComponents<Behaviour>())
                if (b != null && b.GetType().Name.Contains("TrackedPoseDriver")) b.enabled = false;
        }

        private void LateUpdate()
        {
            if (!_active) return;
            var m = Mouse.current;
            if (m == null) return;

            if (!holdRightMouseToLook || m.rightButton.isPressed)
            {
                var d = m.delta.ReadValue();
                _yaw += d.x * sensitivity;
                _pitch = Mathf.Clamp(_pitch - d.y * sensitivity, -85f, 85f);
            }
            transform.localRotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }

        private static float NormalizePitch(float x) => x > 180f ? x - 360f : x;
    }
}
