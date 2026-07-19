using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace WihEditor
{
    /// <summary>
    /// Builds Assets/Art/AgentAnimator.controller from the fox clips in
    /// Assets/Art/animations/*. States: Idle (default), Talk (Speaking bool),
    /// Nod (trigger). Talk uses a placeholder clip until you drop in your
    /// mouth-talk animation — just reassign the Talk state's Motion.
    /// NOTE: the clips must share the agent model's skeleton (Generic retarget by
    /// bone name) or be set to Humanoid, or they won't drive the New+Fox mesh.
    /// </summary>
    public static class WihAnimatorBuilder
    {
        private const string OutPath = "Assets/Art/AgentAnimator.controller";
        private const string AnimDir = "Assets/Art/animations";

        [MenuItem("WhosHuman/Build Agent Animator Controller")]
        public static void Build()
        {
            // Prefer fox_animated's OWN baked clip (same skeleton → plays natively).
            var idle = LoadClipFromFbx("Assets/Art/fox_animated.fbx")
                    ?? LoadClipFromFbx(AnimDir + "/Idle_fox/fox_faceRigged.fbx")
                    ?? LoadClip(AnimDir + "/Idle_fox") ?? LoadClip(AnimDir + "/StandingRelaxed_fox") ?? LoadClip(AnimDir + "/Waiting_fox");
            var talk = idle; // body stays idle while speaking; the mouth is driven by FaceController
            var nod = idle;  // (user asked for idle only)

            EnsureLoop(idle);

            var ac = AnimatorController.CreateAnimatorControllerAtPath(OutPath);
            ac.AddParameter("Speaking", AnimatorControllerParameterType.Bool);
            ac.AddParameter("Nod", AnimatorControllerParameterType.Trigger);
            var sm = ac.layers[0].stateMachine;

            var idleState = sm.AddState("Idle");
            idleState.motion = idle;
            var talkState = sm.AddState("Talk");
            talkState.motion = talk;
            var nodState = sm.AddState("Nod");
            nodState.motion = nod;
            sm.defaultState = idleState;

            var toTalk = idleState.AddTransition(talkState);
            toTalk.hasExitTime = false; toTalk.duration = 0.15f;
            toTalk.AddCondition(AnimatorConditionMode.If, 0, "Speaking");

            var toIdle = talkState.AddTransition(idleState);
            toIdle.hasExitTime = false; toIdle.duration = 0.15f;
            toIdle.AddCondition(AnimatorConditionMode.IfNot, 0, "Speaking");

            var anyNod = sm.AddAnyStateTransition(nodState);
            anyNod.hasExitTime = false; anyNod.duration = 0.1f;
            anyNod.AddCondition(AnimatorConditionMode.If, 0, "Nod");

            var nodExit = nodState.AddTransition(idleState);
            nodExit.hasExitTime = true; nodExit.exitTime = 0.9f; nodExit.duration = 0.15f;

            EditorUtility.SetDirty(ac);
            AssetDatabase.SaveAssets();
            Debug.Log($"[Wih] Built {OutPath} (idle={idle?.name}, talk={talk?.name}, nod={nod?.name}). " +
                      "Reassign the Talk state's Motion to your mouth-talk clip when it's ready.");
        }

        private static AnimationClip LoadClipFromFbx(string path)
        {
            return AssetDatabase.LoadAllAssetsAtPath(path)
                .OfType<AnimationClip>()
                .FirstOrDefault(c => c != null && !c.name.StartsWith("__preview__"));
        }

        private static AnimationClip LoadClip(string folder)
        {
            if (!AssetDatabase.IsValidFolder(folder)) return null;
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { folder }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var clip = AssetDatabase.LoadAllAssetsAtPath(path)
                    .OfType<AnimationClip>()
                    .FirstOrDefault(c => c != null && !c.name.StartsWith("__preview__"));
                if (clip != null) return clip;
            }
            return null;
        }

        private static void EnsureLoop(AnimationClip clip)
        {
            if (clip == null) return;
            var path = AssetDatabase.GetAssetPath(clip);
            if (AssetImporter.GetAtPath(path) is ModelImporter imp)
            {
                var clips = imp.defaultClipAnimations;
                if (clips.Length > 0 && !clips[0].loopTime)
                {
                    clips[0].loopTime = true;
                    imp.clipAnimations = clips;
                    imp.SaveAndReimport();
                }
            }
        }
    }
}
