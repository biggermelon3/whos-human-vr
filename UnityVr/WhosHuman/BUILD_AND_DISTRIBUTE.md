# Building & distributing "Who is Human — VR"

## 0. The one thing to understand first
The VR game is a **thin client**. It renders the fox council and sends the human's
moves; **all game logic + AI runs in the Node server** (`who-is-human`, port 8787).
So any package you distribute must ship **both** the Unity build **and** a way to
run the server, and they must be able to reach each other. That single fact drives
every decision below.

```
[ Unity VR build ]  ──SSE /api/events──▶  [ who-is-human Node server ]
                    ──POST /api/new,/input──▶   demo | api(Claude) | file
```

---

## 1. Pick your target

| | **PC-VR (Windows)** — recommended | **Quest (standalone APK)** |
|---|---|---|
| Where the server runs | bundled on the same PC, auto-launched | a PC on the LAN, or a cloud host (can't run Node inside an APK) |
| Judge setup | one zip, double-click | sideload APK **+** run a server **+** type the PC's IP |
| Verdict | ✅ best for this hackathon | only if headset-native is the whole point |

**Recommendation:** ship a **PC-VR Windows standalone that bundles + auto-launches the
server**, defaulting to the **`demo` backend** (zero keys, works offline), with an
**optional BYOK Claude key** to upgrade the six foxes to real reasoning. Judges play
instantly; a key makes it shine.

---

## 2. The three backends (all selectable in-game now)
The pre-game panel has **Demo / Claude key (BYOK) / Local agents** buttons + **New Game**.

- **Demo** — scripted foxes, no key, instant. The safe default for judges.
- **Claude key (BYOK)** — player pastes their own `sk-ant-…` key; the foxes reason with
  Claude. The key goes to **your** server only, is kept **in memory**, never logged/saved.
- **Local agents (file)** — six CLI sessions (Claude Code / Codex / Gemini) drive the
  foxes via the inbox/outbox bridge. Great for a live demo **on your own machine**;
  **not** for distribution (each player would need the CLIs installed + configured).

### Why BYOK matters for distribution
If you host the server — or even run it locally — you don't want to pay for every
player's Claude usage. **BYOK = each player brings their own key and pays their own
way.** Your build ships as free `demo`; `api` unlocks real AI only when a player
supplies a key. That's exactly the model this project is built for.

---

## 3. Build the Unity client

### PC-VR (recommended)
1. **File ▸ Build Settings** → Platform **Windows/Mac/Linux**, Target **Windows x86_64**.
2. Add **only** the council scene to *Scenes In Build*.
3. **Player Settings**: product name, company, icon; **XR Plug-in Management ▸ OpenXR**
   (PC) enabled, with your interaction profiles (Oculus Touch / Valve Index / Reverb…).
4. Confirm `GameClient.baseUrl = http://127.0.0.1:8787` (default).
5. Build to e.g. `Build/WhosHumanVR/` → you get `WhosHuman.exe` + `WhosHuman_Data/`.

### Quest (alternative)
1. Platform **Android**, **IL2CPP**, **ARM64**, texture compression **ASTC**.
2. **XR Plug-in Management ▸ Android ▸ OpenXR** + the **Meta Quest** feature group and
   interaction profile.
3. Set `GameClient.baseUrl` to the **PC's LAN IP** (e.g. `http://192.168.1.20:8787`) —
   the headset can't reach the PC's `127.0.0.1`. For a cloud host use its `https://…` URL.
4. Build the APK → `adb install -r WhosHuman.apk`.

---

## 4. Bundle the server (for the PC-VR one-click build)
On a Windows standalone build, `ServerBootstrap` auto-runs
`…/WhosHuman_Data/StreamingAssets/server/start-server.bat` on launch and kills it on
quit. So put the server there. It **no-ops** in the Editor, on Android, and when nothing
is bundled — so all three recipes below are safe.

**Recipe A — robust (ships the exact working setup). Recommended.**
1. Copy the whole `who-is-human` folder **including `node_modules`** into
   `WhosHuman_Data/StreamingAssets/server/`.
2. Give it a portable Node so judges don't need Node installed:
   download the **Windows Binary (.zip)** from nodejs.org, extract, and drop `node.exe`
   at `…/StreamingAssets/server/node/node.exe`. `start-server.bat` auto-detects
   `.\node\node.exe`; otherwise it falls back to a system `node`.
3. (Optional, to shrink the zip) delete `logs/`, `tests/`, `.git`, `docs/`.
Result: launching `WhosHuman.exe` silently starts the server, then connects — no
terminal, no setup. Larger zip (~node_modules) but bullet-proof (identical to dev).

**Recipe B — smaller, single-file bundle (advanced).**
`npx esbuild src/server/server.ts --bundle --platform=node --format=cjs --outfile=dist/server/server.cjs`,
then ship `dist/server/server.cjs` + `public/` + portable node, and set (on the
ServerBootstrap component) `serverRelativePath = server/node/node.exe`,
`serverArgs = dist/server/server.cjs`. **Watch the paths:** the server resolves its web
assets as `../../public` from the server file and reads `public/messages.json` at
runtime, so keep that relative layout and **test before shipping**.

**Recipe C — most transparent (no bundling).**
Ship the `who-is-human` folder + `start-server.bat` **next to** the game and a one-line
README: *"run start-server.bat, then WhosHuman.exe."* ServerBootstrap stays a no-op
(nothing in StreamingAssets), and the game connects to the manually-started server.

---

## 5. Server-side prep
- **Restart the server** after this change — it now accepts a per-game BYOK key on
  `/api/new` (`npm start`). The key is passed straight to that game's Claude provider,
  never logged, never written to disk, never echoed back.
- Ship a **demo-default** build: leave `.env` blank (or `WIH_AGENT_BACKEND=demo`). **Do
  not** ship your own `.env` with a real `ANTHROPIC_API_KEY` unless you *want* to pay for
  every player.
- **Cost tip for BYOK players:** a cheaper model cuts cost a lot — set
  `WIH_MODEL=claude-haiku-4-5` (or `claude-sonnet-5`) on the server.

---

## 6. Package & submit
1. Zip the build folder → `WhosHumanVR-win.zip`.
2. Add a `README.txt`:
   - Demo needs nothing — just run it.
   - To use real AI: create a **dedicated, restricted** key at console.anthropic.com,
     click **Claude key (BYOK)**, **Paste key**, **New Game**. It's **memory-only**,
     cleared on quit; use **Forget** any time; **delete/revoke** the key after judging.
   - Quest users: start the server on a PC and set the IP (or use the hosted URL).
3. Record a **2–3 min demo video** (most hackathons require/reward one): a full round,
   the "who is the human?" reveal, and the BYOK upgrade in action.
4. Upload the zip + video + write-up to the hackathon platform.

---

## 7. BYOK security — what the build already enforces
- **Memory only.** Keys live in `ApiKeyStore` static fields, wiped on quit
  (`ApiKeyLifecycle`). Never PlayerPrefs / json / registry / StreamingAssets.
- **Never logged.** Only masked (`sk-ant-…••••…7xQ`). The server also never logs or
  echoes the key.
- **Forget** clears both keys (Claude + the optional OpenAI voice key).
- **Providers never cross:** the Claude key goes to **your server only** (loopback on the
  one-click build); the OpenAI voice key goes to **api.openai.com only**.
- **Transport:** on the localhost one-click build the key never leaves the machine. Over
  LAN or cloud, put the server behind **HTTPS** so the key isn't sent in plaintext.

## 8. Voice input (STT) note
The 🎤 Talk button uses **OpenAI Whisper**, which needs a **separate OpenAI key**
(`sk-…`) — it's optional; players can always type. The single **Paste key** button
auto-routes: `sk-ant-…` → the foxes (Claude), any other `sk-…` → voice (OpenAI).
