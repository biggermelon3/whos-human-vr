"""FastAPI application: HTTP surface for the Kokoro TTS service.

Endpoints:
    GET  /                       -> web test page
    GET  /api/health             -> health / readiness
    GET  /api/voices             -> supported voices (with language)
    GET  /api/catalog            -> languages + voices + presets (UI convenience)
    POST /api/tts                -> generate speech, returns audioUrl
    GET  /api/audio/{id}.wav     -> retrieve a generated WAV

The route handlers stay thin: validation lives in schemas/service, synthesis in
the service, caching in AudioCache. Errors are always returned as structured
JSON; Python stack traces are logged to the terminal only.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .audio_cache import AudioCache
from .schemas import (
    CatalogResponse,
    HealthResponse,
    LanguageInfo,
    PresetInfo,
    TtsRequest,
    TtsResponse,
    VoiceInfo,
    VoicesResponse,
)
from .tts_service import KokoroTtsService, TtsError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("kokoro_tts")

service = KokoroTtsService()
cache = AudioCache(config.GENERATED_AUDIO_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Ensure required directories exist.
    config.GENERATED_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    # 2 & 5. Warm up in a background thread so startup binds immediately and is
    # never blocked indefinitely by the first-run model download. Set
    # KOKORO_SKIP_WARMUP=1 to skip (used by tests / fast restarts).
    if os.getenv("KOKORO_SKIP_WARMUP") != "1":
        def _warm() -> None:
            service.warmup(config.DEFAULT_LANGUAGE)

        threading.Thread(target=_warm, name="kokoro-warmup", daemon=True).start()

    # 4. Print the local test URL.
    logger.info("Kokoro TTS ready. Open http://%s:%d", config.HOST, config.PORT)
    logger.info("Model warm-up is running in the background (first run downloads the model).")
    yield


app = FastAPI(
    title="Kokoro Local TTS",
    version="0.1.0",
    description="Local text-to-speech prototype using Kokoro-82M.",
    lifespan=lifespan,
)

# Same-origin serving means CORS is normally unused; we allow only a small list
# of localhost dev origins (never "*") for cross-port local clients.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Error handlers -> structured JSON (never a stack trace)
# --------------------------------------------------------------------------- #
def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"error": {"code": code, "message": message}}
    )


@app.exception_handler(TtsError)
async def _handle_tts_error(_request, exc: TtsError) -> JSONResponse:
    if exc.http_status >= 500:
        logger.error("TtsError[%s] %s", exc.code, exc.message)
    return _error_response(exc.http_status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _handle_validation_error(_request, exc: RequestValidationError) -> JSONResponse:
    # Turn the first pydantic error into a friendly HTTP 400 message.
    detail = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(part) for part in detail.get("loc", []) if part != "body")
    message = detail.get("msg", "Invalid request.")
    if loc:
        message = f"{loc}: {message}"
    return _error_response(400, "INVALID_REQUEST", message)


# --------------------------------------------------------------------------- #
# Web page + static assets
# --------------------------------------------------------------------------- #
app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(config.STATIC_DIR / "index.html", media_type="text/html")


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model=config.MODEL_NAME,
        sampleRate=config.SAMPLE_RATE,
        device=service.device,
        pipelineLoaded=service.pipeline_loaded,
        languagesReady=service.ready_languages(),
    )


def _voice_infos() -> list[VoiceInfo]:
    return [
        VoiceInfo(
            id=v.id,
            label=v.label,
            language=v.language,
            gender=v.gender,
            grade=v.grade,
        )
        for v in config.VOICES
    ]


@app.get("/api/voices", response_model=VoicesResponse)
async def voices() -> VoicesResponse:
    return VoicesResponse(voices=_voice_infos())


@app.get("/api/catalog", response_model=CatalogResponse)
async def catalog() -> CatalogResponse:
    return CatalogResponse(
        languages=[
            LanguageInfo(id=lang.id, label=lang.label)
            for lang in config.LANGUAGES.values()
        ],
        voices=_voice_infos(),
        presets=[
            PresetInfo(
                name=p.name,
                language=p.language,
                voice=p.voice,
                speed=p.speed,
                sample=p.sample,
            )
            for p in config.PRESETS
        ],
        defaults={
            "language": config.DEFAULT_LANGUAGE,
            "voice": config.DEFAULT_VOICE,
            "speed": config.DEFAULT_SPEED,
        },
    )


@app.post("/api/tts", response_model=TtsResponse)
async def tts(request: TtsRequest) -> TtsResponse:
    # Membership validation (unknown/mismatched voice+language) -> 400.
    service.validate(voice=request.voice, language_id=request.language)

    audio_id = cache.compute_id(
        text=request.text,
        voice=request.voice,
        speed=request.speed,
        language=request.language,
    )
    out_path = cache.path_for(audio_id)
    cached = cache.has(audio_id)

    if not cached:
        # Run blocking CPU inference in a worker thread so the event loop and
        # concurrent requests (e.g. /api/health) are not starved.
        import anyio

        await anyio.to_thread.run_sync(
            lambda: service.synthesize_to_file(
                text=request.text,
                voice=request.voice,
                language_id=request.language,
                speed=request.speed,
                out_path=out_path,
            )
        )

    logger.info(
        "tts request voice=%s language=%s speed=%.2f chars=%d cached=%s id=%s",
        request.voice,
        request.language,
        request.speed,
        len(request.text),
        cached,
        audio_id[:12],
    )
    return TtsResponse(
        audioId=audio_id,
        audioUrl=f"/api/audio/{audio_id}.wav",
        voice=request.voice,
        language=request.language,
        speed=request.speed,
        cached=cached,
    )


@app.get("/api/audio/{audio_id}.wav")
async def get_audio(audio_id: str) -> FileResponse:
    # resolve_existing rejects anything that is not a valid cache id, so the
    # client can never point at an arbitrary path.
    path = cache.resolve_existing(audio_id)
    if path is None:
        raise TtsError(
            "AUDIO_NOT_FOUND",
            "The requested audio was not found.",
            http_status=404,
        )
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"{audio_id}.wav",
    )
