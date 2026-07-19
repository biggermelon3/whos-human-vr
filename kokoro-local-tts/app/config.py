"""Central configuration and the single source of truth for languages, voices,
and character presets.

Keeping the language/voice catalog here (rather than scattering it across the
service and the web UI) makes it trivial to keep `/api/voices`, the pipeline
routing, and validation consistent.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
APP_ROOT: Path = Path(__file__).resolve().parent.parent
GENERATED_AUDIO_DIR: Path = APP_ROOT / "generated_audio"
STATIC_DIR: Path = APP_ROOT / "static"

# --------------------------------------------------------------------------- #
# Model / audio
# --------------------------------------------------------------------------- #
MODEL_NAME: str = "Kokoro-82M"
MODEL_REPO_ID: str = "hexgrad/Kokoro-82M"
# Bump this if the model or generation semantics change; it is part of the
# cache key so stale audio is never served after an upgrade.
MODEL_VERSION: str = "kokoro-82m-1.0"
SAMPLE_RATE: int = 24_000

# --------------------------------------------------------------------------- #
# Request defaults & validation bounds
# --------------------------------------------------------------------------- #
DEFAULT_LANGUAGE: str = "en-US"
DEFAULT_VOICE: str = "af_heart"
DEFAULT_SPEED: float = 1.0

TEXT_MIN_LEN: int = 1
TEXT_MAX_LEN: int = 500
SPEED_MIN: float = 0.7
SPEED_MAX: float = 1.3

# --------------------------------------------------------------------------- #
# Server
# --------------------------------------------------------------------------- #
HOST: str = "127.0.0.1"
PORT: int = 8000

# Same-origin serving means CORS is not required. We still allow a short list of
# localhost dev origins so the web prototype (and, later, the who-is-human game
# UI on another local port) can call this service during development. We never
# use "*".
ALLOWED_ORIGINS: list[str] = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    # who-is-human web app (Express server, default port 8787)
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
]


# --------------------------------------------------------------------------- #
# Language catalog
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Language:
    """A user-facing language mapped to a Kokoro `lang_code`.

    Kokoro selects its grapheme-to-phoneme frontend by a single-character
    `lang_code`: 'a' = American English, 'b' = British English, 'z' = Mandarin.
    """

    id: str  # e.g. "en-US" (BCP-47-ish, what clients send)
    lang_code: str  # Kokoro's single-char code, e.g. "a"
    label: str


LANGUAGES: dict[str, Language] = {
    "en-US": Language("en-US", "a", "English (US)"),
    "en-GB": Language("en-GB", "b", "English (UK)"),
    "zh-CN": Language("zh-CN", "z", "Chinese (Mandarin)"),
}


# --------------------------------------------------------------------------- #
# Voice catalog
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Voice:
    """A Kokoro voice bound to exactly one compatible language.

    The first letter of a Kokoro voice id encodes its language family
    (a*=American, b*=British, z*=Mandarin), so a voice is only valid when the
    request language matches. `grade` is Kokoro's own quality grade (from
    VOICES.md) and is surfaced purely as a UI hint.
    """

    id: str
    label: str
    language: str  # references a key in LANGUAGES
    gender: str  # "female" | "male"
    grade: str  # Kokoro quality grade, e.g. "A", "C+", "D"


# Curated list: >=3 female + >=3 male English voices across US & UK, plus two
# Mandarin voices. Every entry here is verified end-to-end (see SETUP_NOTES.md)
# before being shipped; if a voice fails to render it is removed and documented.
VOICES: list[Voice] = [
    # American English
    Voice("af_heart", "Heart", "en-US", "female", "A"),
    Voice("af_bella", "Bella", "en-US", "female", "A-"),
    Voice("af_nicole", "Nicole", "en-US", "female", "B-"),
    Voice("am_michael", "Michael", "en-US", "male", "C+"),
    Voice("am_fenrir", "Fenrir", "en-US", "male", "C+"),
    Voice("am_puck", "Puck", "en-US", "male", "C+"),
    # British English
    Voice("bf_emma", "Emma", "en-GB", "female", "B-"),
    Voice("bm_george", "George", "en-GB", "male", "C"),
    Voice("bm_fable", "Fable", "en-GB", "male", "C"),
    # Mandarin Chinese
    Voice("zf_xiaoxiao", "Xiaoxiao", "zh-CN", "female", "D"),
    Voice("zm_yunxi", "Yunxi", "zh-CN", "male", "D"),
]

VOICES_BY_ID: dict[str, Voice] = {v.id: v for v in VOICES}


# --------------------------------------------------------------------------- #
# Character voice presets (used by the web test page)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Preset:
    """A themed one-click preset that fills in language, voice, speed, and a
    sample line of dialogue drawn from the who-is-human game."""

    name: str
    language: str
    voice: str
    speed: float
    sample: str


PRESETS: list[Preset] = [
    Preset(
        "Analyst", "en-US", "am_michael", 1.0,
        "I have analyzed every statement. Agent Four's timeline simply does not add up.",
    ),
    Preset(
        "Empath", "en-US", "af_heart", 1.0,
        "I feel like Agent Two is being honest. Their reaction seemed genuine to me.",
    ),
    Preset(
        "Archivist", "en-GB", "bm_george", 0.95,
        "Let me recall the record. On the first night, three of us stayed completely silent.",
    ),
    Preset(
        "Trickster", "en-US", "af_bella", 1.1,
        "Oh, I'm definitely human. Would a mere machine ever be this charming?",
    ),
    Preset(
        "Guardian", "en-US", "am_fenrir", 0.95,
        "I will protect whoever is most at risk tonight. Trust is earned, not given.",
    ),
    Preset(
        "Moderator", "en-GB", "bf_emma", 1.0,
        "The village will now vote. Please cast your ballot for who you believe is the human.",
    ),
]
