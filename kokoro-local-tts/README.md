# kokoro-local-tts

A minimal, reliable **local** text-to-speech service for the **who-is-human**
project. It proves this pipeline end-to-end:

```
Browser text input -> local FastAPI server -> Kokoro speech generation
    -> 24 kHz WAV file -> browser playback
```

This is a **technical spike only**. There is intentionally no Unity, no AI
agents, no game logic, no speech recognition, no lip sync, and no cloud APIs —
just a clean, cached, multi-language TTS endpoint that a browser (and, later,
Unity) can call. No API key, no database, no authentication.

---

## 1. What is Kokoro?

[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) is a small (82M
parameter), fast, open-weight text-to-speech model. It runs comfortably on CPU,
is free, and supports multiple languages and a catalog of named voices. We use
the official [`kokoro`](https://github.com/hexgrad/kokoro) Python package
(`KPipeline`), which downloads the model from Hugging Face on first run and
generates 24 kHz mono audio.

## 2. System requirements

- **Windows** (developed/verified on Windows 11; the commands below are
  Windows-friendly). macOS/Linux work too with the equivalent venv activation.
- **Python `>=3.10,<3.13`** — Kokoro 0.9.4 does **not** support 3.13+. We use
  **3.12**.
- ~1 GB free disk for the model + dependencies; internet access on first run to
  download the model (~few hundred MB, cached afterwards).
- CPU is enough. A GPU is optional and not required.

## 3. Windows setup

We recommend [`uv`](https://docs.astral.sh/uv/) (fast, and it can provision the
right Python for you). Standard `venv` also works.

```powershell
# from the project folder: E:\GameDevelopment\GenAIHackathon\kokoro-local-tts

# 1. Get a compatible Python and an isolated venv
uv python install 3.12
uv venv --python 3.12 .venv

# 2. Install torch (CPU-only wheel) first, then the rest
uv pip install --python .venv\Scripts\python.exe torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv\Scripts\python.exe -e .

# 3. One-time spaCy English model (used by misaki's English G2P)
.venv\Scripts\python.exe -m spacy download en_core_web_sm
```

<details>
<summary>Plain <code>venv</code> alternative (no uv)</summary>

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e .
python -m spacy download en_core_web_sm
```
</details>

## 4. `espeak-ng` setup (usually NOT needed)

English G2P can fall back to espeak-ng for unknown words. **You normally do not
need to install anything**: `misaki[en]` pulls in `espeakng-loader`, which
bundles the espeak-ng library, and it worked out of the box on Windows 11 here.

Only if you hit `RuntimeError: espeak not installed` or an `EspeakWrapper`
error, install the official espeak-ng MSI from
<https://github.com/espeak-ng/espeak-ng/releases> and re-run. Chinese does not
use espeak at all.

## 5. Installation commands

See section 3. In short: install `torch` from the CPU index, then
`uv pip install -e .` (or `pip install -e .`), then download `en_core_web_sm`.

## 6. How to run the server

```powershell
.\run.ps1
```
or
```cmd
run.bat
```
or manually:
```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The server binds immediately and warms up the model **in the background**
(the first run downloads the model). Watch for:

```
Kokoro TTS ready. Open http://127.0.0.1:8000
```

## 7. How to open the web interface

Open **<http://127.0.0.1:8000>** in a browser. The page shows a live health
badge (turns green once the model is loaded), character presets, a language +
voice picker, a speed slider, a text box, and a player with download.

## 8. How to test six different voices

- Click any of the six **character presets** (Analyst, Empath, Archivist,
  Trickster, Guardian, Moderator). Each loads a distinct voice, a speed, and a
  sample line of who-is-human dialogue. Press **Generate**, then **Play**.
- Or pick a **Language** then a **Voice** from the dropdowns (the voice list
  filters to the selected language) and type your own text.
- From the command line you can probe **every** voice at once:
  ```powershell
  .venv\Scripts\python.exe scripts\list_voices.py --probe
  ```

Curated voices (all verified to render audio):

| Language | Female | Male |
| --- | --- | --- |
| en-US | af_heart, af_bella, af_nicole | am_michael, am_fenrir, am_puck |
| en-GB | bf_emma | bm_george, bm_fable |
| zh-CN | zf_xiaoxiao | zm_yunxi |

## 9. API request examples

Generate speech:

```bash
curl -X POST http://127.0.0.1:8000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"I believe Agent Four contradicted their previous statement.","voice":"af_heart","language":"en-US","speed":1.0}'
```
Response:
```json
{
  "audioId": "ac7aad91...d9d4338",
  "audioUrl": "/api/audio/ac7aad91...d9d4338.wav",
  "voice": "af_heart",
  "language": "en-US",
  "speed": 1.0,
  "cached": false
}
```
Chinese:
```bash
curl -X POST http://127.0.0.1:8000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"我认为四号玩家前后的说法存在矛盾。","voice":"zf_xiaoxiao","language":"zh-CN","speed":1.0}'
```

Other endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | status, model, sample rate, device, readiness |
| GET | `/api/voices` | supported voices, each with its language + gender |
| GET | `/api/catalog` | languages + voices + presets + defaults (UI helper) |
| POST | `/api/tts` | generate speech, returns `audioUrl` |
| GET | `/api/audio/{id}.wav` | download the generated WAV (`audio/wav`) |

Validation: `text` 1–500 chars (trimmed), `voice` must be in the supported
list, `voice` must match `language`, `speed` 0.7–1.3. Invalid requests return
`HTTP 400` with a structured `{ "error": { "code", "message" } }` body — never a
stack trace.

## 10. Common errors and fixes

| Symptom | Fix |
| --- | --- |
| `kokoro` install fails on Python 3.13/3.14 | Use Python 3.12 (`uv python install 3.12`). Kokoro requires `<3.13`. |
| `RuntimeError: espeak not installed` | Rare here. Install the espeak-ng MSI (section 4). |
| `UnicodeEncodeError: 'charmap'` when running scripts | The console is cp1252. Scripts already set UTF-8; run with `python` from the venv, or set `PYTHONUTF8=1`. |
| `No format ... from file extension '.wav.tmp'` | Fixed in code (`format="WAV"`). If you see it, update `tts_service.py`. |
| Health badge stays "loading" | First run is downloading the model; watch the terminal. It becomes ready once done. |
| Port 8000 in use | Run uvicorn with `--port 8010` (and update the browser URL). |

## 11. First-run model download behavior

On the first synthesis (or the background warm-up), the `kokoro` package
downloads `kokoro-v1_0.pth` and the requested voice tensors from the Hugging
Face Hub into the local HF cache (`%USERPROFILE%\.cache\huggingface`). This
happens once; subsequent runs are offline-capable for already-downloaded
voices. An "unauthenticated requests to the HF Hub" warning is harmless.

## 12. Where generated files live

Generated WAVs are cached in **`generated_audio/`**, named
`<sha256>.wav`. The SHA-256 is computed from
`text + voice + speed + language + model version`, so an identical request is
served straight from disk (`"cached": true`) and the cache **survives server
restarts**. The folder is kept in git; the WAVs themselves are git-ignored.

## 13. How Unity will consume this later (contract only)

No Unity code exists in this milestone. The intended future contract is:

```
POST /api/tts
  -> receive audioUrl
  -> Unity downloads the WAV (UnityWebRequestMultimedia.GetAudioClip)
  -> Unity assigns the AudioClip to the speaking character's AudioSource
```

Because the service caches by content hash, Unity can request the same line
repeatedly at near-zero cost, and the `language`/`voice` fields map naturally to
per-character voice assignments in the reverse-Turing werewolf game.

---

## Tests

```powershell
# fast tests (no model load): health, validation, cache, path-traversal
.venv\Scripts\python.exe -m pytest

# optional end-to-end smoke tests (loads the model, generates audio)
.venv\Scripts\python.exe -m pytest -m slow
```

## Project layout

```
app/         FastAPI app, Kokoro service, cache, config, schemas
static/      web test page (index.html, app.js, styles.css)
scripts/     list_voices.py (+ --probe), generate_sample.py
tests/       health / validation / smoke tests
generated_audio/  SHA-256-named WAV cache (WAVs git-ignored)
```
