"""Deterministic, file-based WAV cache.

No database: the cache is just WAV files on disk named by a SHA-256 of the
request. The same (text, voice, speed, language, model version) always maps to
the same file, so repeat requests are served without regenerating.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .config import GENERATED_AUDIO_DIR, MODEL_VERSION

# A cache id is always a lowercase SHA-256 hex digest. Validating against this
# pattern is the primary defense against path traversal: no separators, no
# dots, nothing but 64 hex chars can ever reach the filesystem.
_ID_RE = re.compile(r"^[0-9a-f]{64}$")

# Field separator that cannot appear in normal text input, so distinct requests
# can never collide by concatenation (e.g. "ab"+"c" vs "a"+"bc").
_SEP = "\x1f"


class AudioCache:
    def __init__(self, directory: Path = GENERATED_AUDIO_DIR) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def compute_id(
        self,
        *,
        text: str,
        voice: str,
        speed: float,
        language: str,
        model_version: str = MODEL_VERSION,
    ) -> str:
        """Compute the deterministic cache id for a request."""
        payload = _SEP.join(
            [text, voice, f"{speed:.3f}", language, model_version]
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def path_for(self, audio_id: str) -> Path:
        """The on-disk path a given id would occupy (may not exist yet)."""
        return self.directory / f"{audio_id}.wav"

    def has(self, audio_id: str) -> bool:
        return self.path_for(audio_id).is_file()

    def resolve_existing(self, audio_id: str) -> Path | None:
        """Resolve an id to an existing WAV file, or None.

        Returns None for anything that is not a well-formed cache id, does not
        resolve inside the cache directory, or does not exist. Callers must use
        this (never `path_for`) when serving client-supplied ids.
        """
        if not _ID_RE.match(audio_id):
            return None
        path = self.path_for(audio_id)
        try:
            # Belt-and-suspenders: ensure the resolved path is contained in the
            # cache directory even if the id somehow slipped past the regex.
            path.resolve().relative_to(self.directory.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None
