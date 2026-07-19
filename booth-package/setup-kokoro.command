#!/usr/bin/env bash
# ================================================================
#  Who is Human (booth) - one-time kokoro TTS setup on macOS
#  Run ONCE on the Mac booth (needs internet, a few minutes).
#  Double-click, or:  chmod +x setup-kokoro.command && ./setup-kokoro.command
# ================================================================
set -e
cd "$(dirname "$0")/kokoro"

if ! command -v uv >/dev/null 2>&1; then
  echo "[setup] 'uv' not found. Install it once, then re-run this file in a NEW terminal:"
  echo "    curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

echo "[setup] 1/4 creating Python 3.12 venv..."
uv venv --python 3.12 .venv

# On macOS there is no CUDA, so plain torch from PyPI is the right (arm64/x64) wheel.
echo "[setup] 2/4 installing torch..."
uv pip install --python .venv/bin/python torch

echo "[setup] 3/4 installing kokoro + deps + spaCy model..."
uv pip install --python .venv/bin/python "kokoro>=0.9.4" soundfile "misaki[en]>=0.9.4" "misaki[zh]>=0.9.4" "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2"
.venv/bin/python -m spacy download en_core_web_sm

echo "[setup] 4/4 pre-downloading the Kokoro model (warm-up, ~330MB)..."
.venv/bin/python scripts/generate_sample.py --text "Hello, Agent." --voice af_heart --language en-US --out _warmup.wav || true
rm -f _warmup.wav

echo ""
echo "[setup] DONE. kokoro is ready. Use start.command to run the game."
echo "[setup] If English voices error with an espeak message, run:  brew install espeak-ng"
