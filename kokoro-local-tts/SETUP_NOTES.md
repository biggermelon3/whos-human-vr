# SETUP_NOTES

Environment discoveries and decisions made while building this prototype.
Recorded per the spec's "inspect the environment first" step.

## Machine

| Check | Result |
| --- | --- |
| OS | Windows 11 Home (10.0.26200), MSYS/MinGW bash also available |
| System Python | 3.14.0 (`python`) and 3.13 present |
| `uv` | 0.9.5 — available |
| `espeak-ng` (system) | **Not installed** (`espeak-ng` not on PATH) |
| `ffmpeg` | present (not required) |
| `git` | present |

## Key decision: Python version

`kokoro==0.9.4` requires **Python `>=3.10,<3.13`**. The system Pythons (3.14,
3.13) are therefore **not compatible** (3.13 is excluded, 3.14 also lacks some
wheels). We used `uv` to provision an isolated **CPython 3.12.12** and created a
project-local venv — global packages were never touched.

```bash
uv python install 3.12
uv venv --python 3.12 .venv
```

## Key decision: torch CPU wheel

Installed torch from the CPU-only index to keep the download small and avoid any
CUDA driver dependency (this is a CPU spike):

```bash
uv pip install --python .venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu
```

Result: `torch 2.13.0+cpu`, `torch.cuda.is_available() == False`, device = `cpu`.
(`pyproject.toml` encodes this via a `[[tool.uv.index]]` + `[tool.uv.sources]`
entry so `uv sync` reproduces the CPU build.)

## espeak-ng: NOT required as a separate install

This is the biggest Windows gotcha and it resolved cleanly:

- `misaki[en]` (pulled in by kokoro) depends on **`espeakng-loader`** and
  **`phonemizer-fork`**. `espeakng-loader` **bundles the espeak-ng shared
  library**, so English G2P works **without** installing the espeak-ng MSI.
- The well-known Windows errors (`RuntimeError: espeak not installed`,
  `'EspeakWrapper' has no attribute 'set_data_path'`) did **not** occur with the
  current versions (`espeakng-loader 0.2.4`, `phonemizer-fork 3.3.2`). English
  synthesis produced real IPA phonemes (`həlˈO, ˈAʤᵊnt ...`).
- **Chinese (`misaki[zh]`)** does not use espeak at all — it uses
  `jieba` + `pypinyin` + `cn2an`. Verified: `我认为...` → `wo↓ ɻə↘nwei↗ ...`.

If a future machine *does* hit the espeak error, install the espeak-ng MSI from
<https://github.com/espeak-ng/espeak-ng/releases> and re-run.

## Windows gotcha: console encoding (cp1252)

Windows consoles default to **cp1252**. Printing IPA phonemes (e.g. `ə`,
U+0259) or Chinese characters raises `UnicodeEncodeError: 'charmap' codec can't
encode ...`. This bit the first smoke test.

- Fix in helper scripts: `sys.stdout.reconfigure(encoding="utf-8")` at the top
  (done in `scripts/list_voices.py` and `scripts/generate_sample.py`).
- The **server itself is safe**: it never logs input text or phonemes — only
  ASCII fields (voice id, language, speed, char count, cache status).

## Bug found & fixed during verification

`soundfile.write()` infers the output format from the file **extension**. The
service writes atomically to a temp file, and the original temp name ended in
`.wav.tmp`, which soundfile could not recognize
(`TypeError: ... unable to get format from file extension: '...wav.tmp'`).
Fixed by passing `format="WAV"` explicitly to `sf.write()`.

## Installed versions (verified working)

```
kokoro            0.9.4
misaki            0.9.4
torch             2.13.0+cpu
numpy             2.5.1
soundfile         0.14.0
transformers      5.14.1     # bleeding edge, but works fine with kokoro 0.9.4
espeakng-loader   0.2.4
phonemizer-fork   3.3.2
spacy             3.8.14  (+ en_core_web_sm 3.8.0)
jieba / pypinyin / cn2an   (Chinese G2P)
fastapi           0.139.2
uvicorn           0.51.0
pydantic          2.13.4
```

## Exact commands used (one-time setup)

```bash
uv python install 3.12
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/Scripts/python.exe "kokoro>=0.9.4" soundfile "misaki[en]>=0.9.4" "misaki[zh]>=0.9.4" "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2" "pytest>=8" "httpx>=0.27"
.venv/Scripts/python.exe -m spacy download en_core_web_sm
```

## Performance (CPU, short sentences)

| Case | Time |
| --- | --- |
| First model load / warm-up | ~2–5 s (plus first-run model download) |
| First use of a *new* pipeline (en-GB / zh-CN) | ~3 s |
| First use of a *new* voice (same language) | ~3 s (loads the voice tensor) |
| Warm generation, ~10-word sentence | ~1.0–1.5 s |
| Cache hit (repeat request) | ~1 ms |

## Verified voices (all 11 render real audio)

`af_heart, af_bella, af_nicole, am_michael, am_fenrir, am_puck` (en-US),
`bf_emma, bm_george, bm_fable` (en-GB), `zf_xiaoxiao, zm_yunxi` (zh-CN).
Probed with `python scripts/list_voices.py --probe` → 0 failures.
