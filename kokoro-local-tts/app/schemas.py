"""Pydantic request/response models and the shared error type.

All request validation that can be expressed declaratively lives here so the
route handlers stay thin. Membership checks that depend on the runtime catalog
(voice exists, voice matches language) are done in the service layer.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .config import (
    DEFAULT_LANGUAGE,
    DEFAULT_SPEED,
    DEFAULT_VOICE,
    SPEED_MAX,
    SPEED_MIN,
    TEXT_MAX_LEN,
    TEXT_MIN_LEN,
)


class TtsRequest(BaseModel):
    """Body for POST /api/tts."""

    text: str = Field(..., min_length=TEXT_MIN_LEN, max_length=TEXT_MAX_LEN)
    voice: str = Field(default=DEFAULT_VOICE)
    language: str = Field(default=DEFAULT_LANGUAGE)
    speed: float = Field(default=DEFAULT_SPEED, ge=SPEED_MIN, le=SPEED_MAX)

    @field_validator("text", mode="before")
    @classmethod
    def _trim_text(cls, value: object) -> object:
        # Trim surrounding whitespace *before* the length check so that a
        # whitespace-only payload collapses to "" and is rejected as too short.
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("voice", "language", mode="before")
    @classmethod
    def _trim_ids(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class TtsResponse(BaseModel):
    """Body for a successful POST /api/tts."""

    audioId: str
    audioUrl: str
    voice: str
    language: str
    speed: float
    cached: bool


class VoiceInfo(BaseModel):
    id: str
    label: str
    language: str
    gender: str
    grade: str


class VoicesResponse(BaseModel):
    voices: list[VoiceInfo]


class LanguageInfo(BaseModel):
    id: str
    label: str


class PresetInfo(BaseModel):
    name: str
    language: str
    voice: str
    speed: float
    sample: str


class CatalogResponse(BaseModel):
    """Convenience payload the web UI uses to build its dropdowns and presets
    in a single request."""

    languages: list[LanguageInfo]
    voices: list[VoiceInfo]
    presets: list[PresetInfo]
    defaults: dict[str, object]


class HealthResponse(BaseModel):
    status: str
    model: str
    sampleRate: int
    device: str
    pipelineLoaded: bool
    languagesReady: list[str]


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
