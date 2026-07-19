"""Optional end-to-end smoke test (marked `slow` because it loads the real
Kokoro model and generates audio).

Run explicitly with:  pytest -m slow
It is deselected by default (see pyproject `addopts = -m "not slow"`).
"""

import soundfile as sf
from fastapi.testclient import TestClient

from app import main
from app.main import app

import pytest

pytestmark = pytest.mark.slow

client = TestClient(app)


def _generate_and_check(text: str, voice: str, language: str):
    resp = client.post(
        "/api/tts",
        json={"text": text, "voice": voice, "language": language, "speed": 1.0},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["cached"] in (True, False)

    path = main.cache.path_for(data["audioId"])
    assert path.is_file(), "generated WAV should exist on disk"
    assert path.stat().st_size > 0, "generated WAV should be non-empty"

    info = sf.info(str(path))
    assert info.samplerate == 24000
    assert info.frames > 0

    # The WAV must also be retrievable via the audio endpoint as audio/wav.
    audio_resp = client.get(data["audioUrl"])
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"] == "audio/wav"
    assert len(audio_resp.content) > 0


def test_smoke_english_us():
    _generate_and_check("Hello, Agent.", "af_heart", "en-US")


def test_smoke_english_uk():
    _generate_and_check("The village will now vote.", "bf_emma", "en-GB")


def test_smoke_chinese():
    _generate_and_check("我认为四号玩家前后的说法存在矛盾。", "zf_xiaoxiao", "zh-CN")


def test_smoke_cache_hit_on_repeat():
    body = {"text": "Cache me, Agent.", "voice": "af_heart", "language": "en-US", "speed": 1.0}
    first = client.post("/api/tts", json=body)
    assert first.status_code == 200
    second = client.post("/api/tts", json=body)
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert first.json()["audioId"] == second.json()["audioId"]
