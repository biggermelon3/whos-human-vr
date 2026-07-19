"""Health and voice-listing endpoints.

These use TestClient *without* the `with` context manager, so the app lifespan
(and the background model warm-up) never runs — the tests are fast and never
touch the Kokoro model.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["model"] == "Kokoro-82M"
    assert data["sampleRate"] == 24000
    assert data["device"] in {"cpu", "cuda"}
    assert isinstance(data["pipelineLoaded"], bool)
    assert isinstance(data["languagesReady"], list)


def test_voices_returns_multiple_languages():
    resp = client.get("/api/voices")
    assert resp.status_code == 200
    voices = resp.json()["voices"]
    # At least 6 voices, every one tagged with a language + gender.
    assert len(voices) >= 6
    for v in voices:
        assert v["language"] and v["gender"] in {"female", "male"}
    languages = {v["language"] for v in voices}
    assert {"en-US", "en-GB", "zh-CN"} <= languages
    # At least 3 female and 3 male English voices.
    en = [v for v in voices if v["language"].startswith("en")]
    assert sum(v["gender"] == "female" for v in en) >= 3
    assert sum(v["gender"] == "male" for v in en) >= 3
    # At least 2 Mandarin voices.
    assert sum(v["language"] == "zh-CN" for v in voices) >= 2


def test_catalog_has_presets():
    resp = client.get("/api/catalog")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["languages"]) == 3
    assert len(data["presets"]) == 6
    # Every preset references a real voice whose language matches.
    voices_by_id = {v["id"]: v for v in data["voices"]}
    for preset in data["presets"]:
        assert preset["voice"] in voices_by_id
        assert voices_by_id[preset["voice"]]["language"] == preset["language"]
