using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Wih;

namespace WihEditor
{
    /// <summary>
    /// Builds the VR council: strips template clutter, rings 7 fox agents
    /// (Art/prefab/Agent.prefab) around a table with a shared Wih/AgentScarf
    /// material (per-agent scarf color set at runtime), seats the player, and
    /// wires mouse-look. Falls back to capsules if the fox prefab is missing.
    /// </summary>
    public static class WihSceneBuilder
    {
        private const int Seats = 7;
        private const float Radius = 1.6f;
        private const string RootName = "WhosHuman Council";
        private const string FoxModel = "Assets/Art/fox_animated.fbx"; // skinned + face-rigged
        private const string AgentPrefab = "Assets/Art/prefab/Agent.prefab";
        private const string ScarfMatPath = "Assets/Art/AgentScarf.mat";
        private const string ScarfMaskPath = "Assets/Art/ScarfMask.png";
        private const string AnimCtrlPath = "Assets/Art/AgentAnimator.controller";

        private static readonly string[] Clutter = { "Interactables", "UI", "Teleport Area Setup", RootName };

        // Orient/raise the agent to taste — the New+Fox imports body-horizontal.
        // Set AgentTilt (local Euler, applied after facing the centre) to stand/sit
        // it, e.g. (-90,0,0) or (0,0,90); AgentLift raises it to table height.
        private static readonly Vector3 AgentTilt = new Vector3(0f, 0f, 0f);
        private const float AgentLift = 0.0f;
        private const float PlayerEyeHeight = 1.0f; // seated player eye height ≈ fox height (a bit taller)

        [MenuItem("WhosHuman/Build Council Scene")]
        public static void Build()
        {
            foreach (var name in Clutter)
            {
                var go = GameObject.Find(name);
                if (go != null) Object.DestroyImmediate(go);
            }

            var root = new GameObject(RootName);

            // No visible floor/table primitives (the scene has its own environment + table),
            // but keep an INVISIBLE ground collider so the seated rig doesn't fall through
            // the world if the env deck has no collider of its own.
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GroundCollider";
            ground.transform.SetParent(root.transform, false);
            ground.transform.localScale = new Vector3(4f, 1f, 4f);
            var groundRend = ground.GetComponent<Renderer>();
            if (groundRend != null) groundRend.enabled = false;

            // Prefer the skinned + face-rigged fox; fall back to the older rig / prefab.
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(FoxModel)
                      ?? AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Art/animations/Idle_fox/fox_faceRigged.fbx")
                      ?? AssetDatabase.LoadAssetAtPath<GameObject>(AgentPrefab);
            var foxAvatar = AssetDatabase.LoadAllAssetsAtPath(FoxModel).OfType<Avatar>().FirstOrDefault();
            var animCtrl = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(AnimCtrlPath);
            var scarfShader = Shader.Find("Wih/AgentScarf");
            var scarfMask = AssetDatabase.LoadAssetAtPath<Texture2D>(ScarfMaskPath);
            Texture foxBaseMap = null;
            const string MatDir = "Assets/Art/AgentMats";
            if (scarfShader != null && !AssetDatabase.IsValidFolder(MatDir)) AssetDatabase.CreateFolder("Assets/Art", "AgentMats");

            for (int i = 0; i < Seats; i++)
            {
                string id = $"A-0{i + 1}";
                float a = i * (Mathf.PI * 2f / Seats);
                var pos = new Vector3(Mathf.Sin(a) * Radius, 0, Mathf.Cos(a) * Radius);
                var faceCenter = Quaternion.AngleAxis(Mathf.Atan2(-pos.x, -pos.z) * Mathf.Rad2Deg, Vector3.up);
                var color = Color.HSVToRGB(i / (float)Seats, 0.7f, 0.95f);

                GameObject agent;
                Renderer bodyRend = null;
                if (prefab != null)
                {
                    agent = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.transform);
                    agent.name = "Agent_" + id;
                    NormalizeSize(agent, 1.1f, 1);
                    agent.transform.SetPositionAndRotation(pos + Vector3.up * AgentLift, faceCenter * Quaternion.Euler(AgentTilt));

                    // The BODY is the skinned mesh — put the scarf/emission material there,
                    // not on a tiny eye-disc MeshRenderer.
                    bodyRend = agent.GetComponentInChildren<SkinnedMeshRenderer>();
                    if (bodyRend == null) bodyRend = agent.GetComponentInChildren<Renderer>();
                    var rend = bodyRend;
                    if (rend != null && scarfShader != null)
                    {
                        if (foxBaseMap == null && rend.sharedMaterial != null)
                        {
                            var s = rend.sharedMaterial;
                            if (s.HasProperty("_BaseMap") && s.GetTexture("_BaseMap") != null) foxBaseMap = s.GetTexture("_BaseMap");
                            else if (s.HasProperty("_MainTex") && s.GetTexture("_MainTex") != null) foxBaseMap = s.GetTexture("_MainTex");
                        }
                        if (foxBaseMap == null)
                            foxBaseMap = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Art/New+Fox+3d+model.fbm/New+Fox+3d+model_basecolor.jpg");

                        var mat = new Material(scarfShader);
                        if (foxBaseMap != null) mat.SetTexture("_BaseMap", foxBaseMap);
                        if (scarfMask != null) mat.SetTexture("_ScarfMask", scarfMask);
                        mat.SetColor("_BaseColor", Color.white);
                        mat.SetColor("_ScarfColor", color); // baked per agent (visible in edit mode)
                        string mp = $"{MatDir}/AgentMat_{id}.mat";
                        AssetDatabase.DeleteAsset(mp);
                        AssetDatabase.CreateAsset(mat, mp);
                        rend.sharedMaterial = mat;
                    }
                    var anim = agent.GetComponentInChildren<Animator>() ?? agent.AddComponent<Animator>();
                    if (foxAvatar != null) anim.avatar = foxAvatar; // Generic avatar → clips can drive the skeleton
                    if (animCtrl != null) anim.runtimeAnimatorController = animCtrl;
                    var aa = agent.AddComponent<AgentAnimator>();
                    aa.animator = anim;
                }
                else
                {
                    agent = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    agent.name = "Agent_" + id;
                    agent.transform.SetParent(root.transform, false);
                    agent.transform.localScale = new Vector3(0.45f, 0.55f, 0.45f);
                    agent.transform.SetPositionAndRotation(pos + Vector3.up * 0.9f, faceCenter);
                    Colorize(agent, color);
                }

                if (agent.GetComponent<AudioSource>() == null) agent.AddComponent<AudioSource>();
                var av = agent.AddComponent<AgentAvatar>();
                if (bodyRend != null) av.targetRenderer = bodyRend; // color + speaking glow on the body
                av.id = id;
                av.baseColor = color;
                av.displayName = "";          // empty → nameplate shows the numeric id (A-0X)
                av.nameplateHeight = 1.2f;
                if (prefab != null) AutoWireFace(agent);
            }

            var gm = new GameObject("WihGameManager");
            gm.transform.SetParent(root.transform, false);
            var client = gm.AddComponent<GameClient>();
            var tts = gm.AddComponent<TtsClient>();
            var uiComp = gm.AddComponent<GameUi>();
            var director = gm.AddComponent<GameDirector>();
            director.client = client;
            director.tts = tts;
            director.ui = uiComp;
            uiComp.client = client;                         // backend selector + New Game button
            uiComp.speech = gm.AddComponent<SpeechInput>(); // voice input (BYOK)
            gm.AddComponent<ApiKeyLifecycle>();             // wipes the key on quit
            gm.AddComponent<ServerBootstrap>();             // one-click: launch bundled server on Win standalone (no-op in editor)
            var gaze = gm.AddComponent<GazeReporter>();     // feeds the human's gaze/hesitation to the agents
            gaze.client = client;

            SeatPlayer();
            EnsureLight();
            AssetDatabase.SaveAssets(); // persist the per-agent materials

            Selection.activeGameObject = root;
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            Debug.Log($"[Wih] Council built ({(prefab != null ? "fox agents" : "capsule fallback")}). " +
                      $"Add a scarf mask at {ScarfMaskPath} (white = scarf) and rerun to tint scarves. " +
                      "RIGHT-mouse to look, LEFT-click agents/buttons to act.");
        }

        private static void NormalizeSize(GameObject go, float target, int axis)
        {
            var rends = go.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return;
            var b = rends[0].bounds;
            foreach (var r in rends) b.Encapsulate(r.bounds);
            float size = axis == 0 ? b.size.x : (axis == 1 ? b.size.y : b.size.z);
            if (size < 1e-4f) return;
            go.transform.localScale *= target / size;
        }

        private static void SeatPlayer()
        {
            var xr = GameObject.Find("XR Origin Hands (XR Rig)") ?? GameObject.Find("XR Origin (XR Rig)") ?? GameObject.Find("XR Origin");
            if (xr == null)
                foreach (var go in EditorSceneManager.GetActiveScene().GetRootGameObjects())
                    foreach (var c in go.GetComponentsInChildren<Component>(true))
                        if (c != null && c.GetType().Name == "XROrigin") { xr = c.gameObject; break; }
            if (xr == null)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Samples/XR Interaction Toolkit/3.4.1/Starter Assets/Prefabs/XR Origin (XR Rig).prefab");
                if (prefab != null) xr = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            }
            if (xr != null)
            {
                xr.transform.SetPositionAndRotation(new Vector3(0, 0, -(Radius + 1.1f)), Quaternion.identity);
                // Shrink the player to about fox height (a touch taller than the foxes)
                // by lowering the Camera Offset. In room-scale VR the real HMD height
                // still applies; tune PlayerEyeHeight if it feels off in the headset.
                var camOffset = FindDescendant(xr.transform, "Camera Offset");
                if (camOffset != null) { var lp = camOffset.localPosition; lp.y = PlayerEyeHeight; camOffset.localPosition = lp; }
            }

            var cam = Camera.main;
            if (cam != null && cam.GetComponent<SeatedMouseLook>() == null)
                cam.gameObject.AddComponent<SeatedMouseLook>();
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name) return t;
            return null;
        }

        private static void EnsureLight()
        {
            if (Object.FindFirstObjectByType<Light>() != null) return;
            var lgo = new GameObject("Directional Light");
            var l = lgo.AddComponent<Light>();
            l.type = LightType.Directional;
            l.intensity = 1.1f;
            lgo.transform.rotation = Quaternion.Euler(50, -30, 0);
        }

        private static void Colorize(GameObject go, Color c)
        {
            var r = go.GetComponent<Renderer>();
            if (r == null) return;
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            var m = shader != null ? new Material(shader) : new Material(r.sharedMaterial);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            m.color = c;
            r.sharedMaterial = m;
        }

        private static string ColorName(int i)
        {
            string[] names = { "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Violet" };
            return names[i % names.Length];
        }

        // Auto-wire the FaceController to fox_animated's face bones. Naming is
        // prefix-based (L_EyeCenter / R_Ear / LowerLip / Nose). Verify in Inspector.
        private static void AutoWireFace(GameObject agent)
        {
            var fc = agent.GetComponentInChildren<FaceController>() ?? agent.AddComponent<FaceController>();
            Transform le = null, re = null, lEar = null, rEar = null, mouth = null, nose = null, head = null;
            foreach (var t in agent.GetComponentsInChildren<Transform>(true))
            {
                string n = t.name.ToLowerInvariant();
                bool L = IsLeft(n), R = IsRight(n);
                if (n.Contains("eye"))                              // L_EyeCenter/EyeBall, R_...
                {
                    if (L) le = PreferPivot(le, t);
                    else if (R) re = PreferPivot(re, t);
                }
                else if (n.Contains("ear") && !n.Contains("forearm")) // L_Ear / R_Ear (not Forearm!)
                {
                    if (L && lEar == null) lEar = t;
                    else if (R && rEar == null) rEar = t;
                }
                else if (mouth == null && (n.Contains("lowerlip") || n.Contains("lip") || n.Contains("jaw") || n.Contains("mouth"))) mouth = t;
                else if (nose == null && n.Contains("nose")) nose = t;
                else if (head == null && n == "head") head = t;
            }
            fc.leftEye = le; fc.rightEye = re;
            fc.leftEar = lEar; fc.rightEar = rEar;
            fc.jawBone = mouth != null ? mouth : nose;   // LowerLip drives the mouth
            fc.noseBone = nose;                          // nose gets its own occasional twitch
            var smr = agent.GetComponentInChildren<SkinnedMeshRenderer>();
            if (smr != null) fc.faceMesh = smr;

            var av = agent.GetComponent<AgentAvatar>();  // others aim their gaze at this fox's head
            if (av != null) av.headAnchor = head != null ? head : (le != null ? le : agent.transform);
        }

        // Prefer the eye rotation pivot ("...Center") over the eyeball/disc when both exist.
        private static Transform PreferPivot(Transform cur, Transform cand)
        {
            if (cur == null) return cand;
            bool curCenter = cur.name.ToLowerInvariant().Contains("center");
            bool candCenter = cand.name.ToLowerInvariant().Contains("center");
            return (candCenter && !curCenter) ? cand : cur;
        }

        private static bool IsLeft(string n) =>
            n.StartsWith("l_") || n.StartsWith("l.") || n.StartsWith("left") || n.Contains("left") || n.EndsWith("_l") || n.EndsWith(".l");
        private static bool IsRight(string n) =>
            n.StartsWith("r_") || n.StartsWith("r.") || n.StartsWith("right") || n.Contains("right") || n.EndsWith("_r") || n.EndsWith(".r");
    }
}
