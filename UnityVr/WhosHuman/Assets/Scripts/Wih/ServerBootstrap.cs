using System.Diagnostics;
using System.IO;
using UnityEngine;

namespace Wih
{
    /// <summary>
    /// Makes a distributed Windows build one-click: launches the bundled
    /// "who-is-human" Node server (StreamingAssets/server/…) on startup and kills
    /// it on quit, so the player doesn't have to run the server by hand.
    ///
    /// It NO-OPS when:
    ///   • running in the Editor (you run `npm start` yourself),
    ///   • on Android/Quest (can't host Node in the APK — use a PC/cloud server),
    ///   • or no server is bundled at the expected path (then it assumes an
    ///     external server and just lets GameClient connect to baseUrl).
    /// If a server is already listening on the port, the launched one exits on
    /// EADDRINUSE and we ignore it.
    /// </summary>
    public class ServerBootstrap : MonoBehaviour
    {
        [Tooltip("Path under StreamingAssets to the bundled server launcher. A .bat/.cmd " +
                 "is run via cmd /c; anything else is executed directly with serverArgs. " +
                 "Leave as-is if you follow the packaging guide (BUILD_AND_DISTRIBUTE.md).")]
        public string serverRelativePath = "server/start-server.bat";

        [Tooltip("Arguments when the target is a real exe (ignored for .bat/.cmd). " +
                 "e.g. for a bundled portable node: set path to server/node.exe and args to \"server.cjs\".")]
        public string serverArgs = "";

        private Process _proc;

        private void Awake()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            try
            {
                string path = Path.Combine(Application.streamingAssetsPath, serverRelativePath);
                if (!File.Exists(path)) return; // nothing bundled → external server expected
                string dir = Path.GetDirectoryName(path);
                bool isBatch = path.EndsWith(".bat") || path.EndsWith(".cmd");
                var psi = new ProcessStartInfo
                {
                    FileName = isBatch ? "cmd.exe" : path,
                    Arguments = isBatch ? $"/c \"{path}\"" : serverArgs,
                    WorkingDirectory = dir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                _proc = Process.Start(psi);
            }
            catch
            {
                // A server may already be running (EADDRINUSE) or AV blocked us — ignore
                // and let GameClient connect to whatever is on the port.
            }
#endif
        }

        private void OnApplicationQuit() => Kill();
        private void OnDestroy() => Kill();

        private void Kill()
        {
            try { if (_proc != null && !_proc.HasExited) _proc.Kill(); }
            catch { /* already gone */ }
            _proc = null;
        }
    }
}
