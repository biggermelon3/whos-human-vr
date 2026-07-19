"""Request validation, cache-key determinism, cache reuse, and path-traversal
protection.

All of these run without loading the Kokoro model: invalid requests are
rejected before synthesis, and the cache-reuse test pre-seeds a WAV file so the
cache-hit path is exercised without generating anything.
"""

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import main
from app.audio_cache import AudioCache
from app.main import app

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Request validation -> HTTP 400 structured errors
# --------------------------------------------------------------------------- #
def _post(**overrides):
    body = {"text": "Hello, Agent.", "voice": "af_heart", "language": "en-US", "speed": 1.0}
    body.update(overrides)
    return client.post("/api/tts", json=body)


def test_unsupported_voice_rejected():
    resp = _post(voice="not_a_real_voice")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VOICE_UNAVAILABLE"


def test_language_voice_mismatch_rejected():
    # af_heart is en-US; asking for it under zh-CN must fail.
    resp = _post(voice="af_heart", language="zh-CN")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "LANGUAGE_VOICE_MISMATCH"


def test_unsupported_language_rejected():
    resp = _post(voice="af_heart", language="fr-FR")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] in {"LANGUAGE_UNSUPPORTED", "LANGUAGE_VOICE_MISMATCH"}


def test_empty_text_rejected():
    resp = _post(text="")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def test_whitespace_only_text_rejected():
    resp = _post(text="   \n\t  ")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def test_too_long_text_rejected():
    resp = _post(text="x" * 501)
    assert resp.status_code == 400


def test_invalid_speed_rejected():
    assert _post(speed=2.0).status_code == 400
    assert _post(speed=0.1).status_code == 400


# --------------------------------------------------------------------------- #
# Cache key determinism
# --------------------------------------------------------------------------- #
def test_cache_key_is_deterministic(tmp_path):
    cache = AudioCache(tmp_path)
    a = cache.compute_id(text="Hello, Agent.", voice="af_heart", speed=1.0, language="en-US")
    b = cache.compute_id(text="Hello, Agent.", voice="af_heart", speed=1.0, language="en-US")
    assert a == b
    assert len(a) == 64 and all(c in "0123456789abcdef" for c in a)


def test_cache_key_varies_by_field(tmp_path):
    cache = AudioCache(tmp_path)
    base = cache.compute_id(text="Hi", voice="af_heart", speed=1.0, language="en-US")
    assert base != cache.compute_id(text="Hi!", voice="af_heart", speed=1.0, language="en-US")
    assert base != cache.compute_id(text="Hi", voice="af_bella", speed=1.0, language="en-US")
    assert base != cache.compute_id(text="Hi", voice="af_heart", speed=1.1, language="en-US")
    # Language is part of the key even when text/voice/speed match.
    assert base != cache.compute_id(text="Hi", voice="af_heart", speed=1.0, language="en-GB")


# --------------------------------------------------------------------------- #
# Cache reuse (no model needed: pre-seed the WAV)
# --------------------------------------------------------------------------- #
def test_cached_request_is_reused():
    body = {"text": "Reuse me, please.", "voice": "af_heart", "language": "en-US", "speed": 1.0}
    audio_id = main.cache.compute_id(
        text=body["text"], voice=body["voice"], speed=body["speed"], language=body["language"]
    )
    path = main.cache.path_for(audio_id)
    sf.write(str(path), np.zeros(2400, dtype="float32"), 24000, subtype="PCM_16")
    try:
        resp = client.post("/api/tts", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert data["cached"] is True
        assert data["audioId"] == audio_id
        assert data["audioUrl"] == f"/api/audio/{audio_id}.wav"
    finally:
        path.unlink(missing_ok=True)


# --------------------------------------------------------------------------- #
# Path traversal protection
# --------------------------------------------------------------------------- #
def test_audio_cache_rejects_unsafe_ids(tmp_path):
    cache = AudioCache(tmp_path)
    assert cache.resolve_existing("../secret") is None
    assert cache.resolve_existing("..\\secret") is None
    assert cache.resolve_existing("a" * 63) is None  # too short
    assert cache.resolve_existing("g" * 64) is None  # non-hex
    assert cache.resolve_existing("a" * 64) is None  # well-formed but missing


def test_audio_endpoint_rejects_traversal():
    for bad in ["deadbeef", "not-a-hash", "%2e%2e%2fmain"]:
        resp = client.get(f"/api/audio/{bad}.wav")
        assert resp.status_code == 404
