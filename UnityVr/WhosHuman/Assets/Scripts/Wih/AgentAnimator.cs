using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Drives an agent's Animator from game state: idle by default, "talk" while
    /// speaking, an optional nod on vote. It sets a bool parameter (default
    /// "Speaking") and a trigger (default "Nod") IF the controller declares them,
    /// so it's a safe no-op until you finish wiring the AnimatorController + clips
    /// (menu: WhosHuman ▸ Build Agent Animator Controller). Attach next to the
    /// agent's Animator (auto-found on self or children).
    /// </summary>
    public class AgentAnimator : MonoBehaviour
    {
        public Animator animator;
        public string speakingBool = "Speaking";
        public string nodTrigger = "Nod";

        private int _speakingId, _nodId;
        private bool _ready;

        private void Awake()
        {
            if (animator == null) animator = GetComponentInChildren<Animator>();
            _speakingId = Animator.StringToHash(speakingBool);
            _nodId = Animator.StringToHash(nodTrigger);
            _ready = animator != null && animator.runtimeAnimatorController != null;
        }

        public void SetSpeaking(bool on)
        {
            if (_ready && HasParam(speakingBool)) animator.SetBool(_speakingId, on);
        }

        public void Nod()
        {
            if (_ready && HasParam(nodTrigger)) animator.SetTrigger(_nodId);
        }

        public void SetAlive(bool alive)
        {
            if (_ready) animator.speed = alive ? 1f : 0f; // freeze when eliminated
        }

        private bool HasParam(string n)
        {
            if (animator == null) return false;
            foreach (var p in animator.parameters)
                if (p.name == n) return true;
            return false;
        }
    }
}
