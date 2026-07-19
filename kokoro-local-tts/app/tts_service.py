"""Kokoro synthesis service.

Owns the Kokoro pipelines (one lazily-created `KPipeline` per language, cached
for the process lifetime) and turns validated requests into WAV files. All
Kokoro-specific knowledge lives here; the web layer only ever sees plain data
and `TtsError`.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import soundfile as sf

from .config import (
    DEFAULT_VOICE,
    LANGUAGES,
    MODEL_REPO_ID,
    SAMPLE_RATE,
    VOICES_BY_ID,
)

if TYPE_CHECKING:  # avoid importing torch/kokoro at module import time
    from kokoro import KPipeline

logger = logging.getLogger("kokoro_tts")


class TtsError(Exception):
    """A structured, client-safe error.

    `code` is a stable machine-readable string; `message` is human-readable and
    safe to show in the browser (never a stack trace or secret).
    """

    def __init__(self, code: str, message: str, http_status: int = 500) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status


class KokoroTtsService:
    def __init__(self) -> None:
        # lang_code (e.g. "a") -> KPipeline
        self._pipelines: dict[str, "KPipeline"] = {}
        self._KPipeline: type["KPipeline"] | None = None
        self._device: str = "cpu"
        # Separate locks: one guards pipeline creation (the dict), one
        # serializes inference (Kokoro/torch state is not safe to run
        # concurrently from multiple threads for the same pipeline).
        self._create_lock = threading.Lock()
        self._infer_lock = threading.Lock()

    # ------------------------------------------------------------------ #
    # Lazy imports / device
    # ------------------------------------------------------------------ #
    def _kpipeline_cls(self) -> type["KPipeline"]:
        if self._KPipeline is None:
            try:
                import torch  # noqa: WPS433 (local import is intentional)
                from kokoro import KPipeline
            except Exception as exc:  # pragma: no cover - env-specific
                logger.exception("Failed to import Kokoro/torch")
                raise TtsError(
                    "KOKORO_UNAVAILABLE",
                    "The Kokoro TTS package could not be loaded. "
                    "Check the server installation.",
                    http_status=503,
                ) from exc
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._KPipeline = KPipeline
        return self._KPipeline

    @property
    def device(self) -> str:
        return self._device

    # ------------------------------------------------------------------ #
    # Pipeline management
    # ------------------------------------------------------------------ #
    def _get_pipeline(self, language_id: str) -> "KPipeline":
        language = LANGUAGES[language_id]  # caller has validated membership
        # Fast path without the lock once created.
        pipeline = self._pipelines.get(language.lang_code)
        if pipeline is not None:
            return pipeline
        with self._create_lock:
            pipeline = self._pipelines.get(language.lang_code)
            if pipeline is None:
                kpipeline_cls = self._kpipeline_cls()
                logger.info(
                    "Loading Kokoro pipeline for %s (lang_code=%s)",
                    language_id,
                    language.lang_code,
                )
                try:
                    pipeline = kpipeline_cls(
                        lang_code=language.lang_code, repo_id=MODEL_REPO_ID
                    )
                except Exception as exc:
                    logger.exception(
                        "Failed to initialize pipeline for %s", language_id
                    )
                    raise TtsError(
                        "PIPELINE_INIT_FAILED",
                        f"Could not initialize the {language_id} voice engine.",
                        http_status=503,
                    ) from exc
                self._pipelines[language.lang_code] = pipeline
            return pipeline

    def ready_languages(self) -> list[str]:
        loaded_codes = set(self._pipelines.keys())
        return [
            lang.id for lang in LANGUAGES.values() if lang.lang_code in loaded_codes
        ]

    @property
    def pipeline_loaded(self) -> bool:
        return bool(self._pipelines)

    # ------------------------------------------------------------------ #
    # Validation
    # ------------------------------------------------------------------ #
    def validate(self, *, voice: str, language_id: str) -> None:
        """Reject unknown languages/voices and mismatched combinations.

        Raises TtsError with HTTP 400 on any problem.
        """
        if language_id not in LANGUAGES:
            raise TtsError(
                "LANGUAGE_UNSUPPORTED",
                f"Language '{language_id}' is not supported.",
                http_status=400,
            )
        voice_def = VOICES_BY_ID.get(voice)
        if voice_def is None:
            raise TtsError(
                "VOICE_UNAVAILABLE",
                f"Voice '{voice}' is not in the supported voice list.",
                http_status=400,
            )
        if voice_def.language != language_id:
            raise TtsError(
                "LANGUAGE_VOICE_MISMATCH",
                f"Voice '{voice}' belongs to {voice_def.language}, "
                f"not {language_id}.",
                http_status=400,
            )

    # ------------------------------------------------------------------ #
    # Synthesis
    # ------------------------------------------------------------------ #
    def _synthesize_array(
        self, *, text: str, voice: str, language_id: str, speed: float
    ) -> np.ndarray:
        pipeline = self._get_pipeline(language_id)
        segments: list[np.ndarray] = []
        # Serialize inference; Kokoro is not guaranteed thread-safe.
        with self._infer_lock:
            for _graphemes, _phonemes, audio in pipeline(
                text, voice=voice, speed=speed
            ):
                if audio is None:
                    continue
                if hasattr(audio, "detach"):  # torch.Tensor
                    array = audio.detach().cpu().numpy()
                else:
                    array = np.asarray(audio)
                segments.append(np.asarray(array, dtype=np.float32).reshape(-1))
        if not segments:
            raise TtsError(
                "EMPTY_GENERATION",
                "No audio was produced for the given text.",
                http_status=422,
            )
        return segments[0] if len(segments) == 1 else np.concatenate(segments)

    def synthesize_to_file(
        self, *, text: str, voice: str, language_id: str, speed: float, out_path: Path
    ) -> float:
        """Generate speech and write it as a 24 kHz PCM_16 WAV file.

        Returns the wall-clock generation time in seconds. Writes atomically
        (temp file + rename) so a crash never leaves a truncated cached file.
        Never logs the input text (privacy + this service needs no secrets).
        """
        start = time.perf_counter()
        audio = self._synthesize_array(
            text=text, voice=voice, language_id=language_id, speed=speed
        )

        # Unique temp name per write: two identical concurrent requests hash to
        # the same audio_id, so a shared temp name could collide (on Windows,
        # os.replace over a handle still open for writing raises a sharing
        # violation). A uuid makes the atomic temp+rename correct regardless of
        # timing. `format="WAV"` is required because the extension isn't ".wav".
        tmp_path = out_path.with_name(f"{out_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            sf.write(str(tmp_path), audio, SAMPLE_RATE, subtype="PCM_16", format="WAV")
            tmp_path.replace(out_path)
        except Exception as exc:
            logger.exception("Failed to write WAV to %s", out_path)
            tmp_path.unlink(missing_ok=True)
            raise TtsError(
                "WAV_WRITE_FAILED",
                "The generated audio could not be saved.",
                http_status=500,
            ) from exc

        elapsed = time.perf_counter() - start
        logger.info(
            "synthesized voice=%s language=%s speed=%.2f chars=%d "
            "duration=%.2fs gen_time=%.2fs",
            voice,
            language_id,
            speed,
            len(text),
            audio.shape[0] / SAMPLE_RATE,
            elapsed,
        )
        return elapsed

    # ------------------------------------------------------------------ #
    # Warm-up
    # ------------------------------------------------------------------ #
    def warmup(self, language_id: str = "en-US") -> None:
        """Preload a pipeline and run a tiny generation to JIT the model.

        Best-effort: callers should treat failure as non-fatal so startup is
        never blocked indefinitely.
        """
        voice = DEFAULT_VOICE
        try:
            self._synthesize_array(
                text="Hi.", voice=voice, language_id=language_id, speed=1.0
            )
            logger.info("Warm-up complete for %s (device=%s)", language_id, self.device)
        except Exception:
            logger.warning("Warm-up for %s failed (non-fatal)", language_id, exc_info=True)
