"""Inspect and (optionally) test the curated voice list.

Usage:
    python scripts/list_voices.py            # just print the catalog
    python scripts/list_voices.py --probe    # actually synthesize a short clip
                                             # per voice and report pass/fail

The --probe mode loads the Kokoro model and is the tool used to verify a voice
before it is trusted in the curated list.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Windows consoles default to cp1252; IPA/CJK output needs UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Allow running as a plain script from the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import LANGUAGES, VOICES  # noqa: E402

PROBE_TEXT = {
    "en-US": "Hello, Agent. This is a short test.",
    "en-GB": "Hello, Agent. This is a short test.",
    "zh-CN": "你好，这是一个简短的测试。",
}


def print_catalog() -> None:
    for lang in LANGUAGES.values():
        print(f"\n== {lang.label}  (id={lang.id}, lang_code={lang.lang_code}) ==")
        for v in VOICES:
            if v.language == lang.id:
                print(f"  {v.id:<14} {v.label:<10} {v.gender:<7} grade={v.grade}")


def probe() -> int:
    from app.tts_service import KokoroTtsService

    service = KokoroTtsService()
    out_dir = Path(__file__).resolve().parent.parent / "generated_audio"
    out_dir.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    for v in VOICES:
        text = PROBE_TEXT[v.language]
        out = out_dir / f"probe_{v.id}.wav"
        try:
            service.synthesize_to_file(
                text=text, voice=v.id, language_id=v.language, speed=1.0, out_path=out
            )
            size = out.stat().st_size
            print(f"  OK   {v.id:<14} ({v.language})  -> {out.name} ({size} bytes)")
        except Exception as exc:  # noqa: BLE001 - report and continue
            failures.append(v.id)
            print(f"  FAIL {v.id:<14} ({v.language})  -> {type(exc).__name__}: {exc}")

    print(f"\nProbed {len(VOICES)} voices, {len(failures)} failure(s).")
    if failures:
        print("Failing voices (remove from the curated list):", ", ".join(failures))
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="List / probe Kokoro voices")
    parser.add_argument(
        "--probe", action="store_true", help="synthesize a clip per voice to verify it"
    )
    args = parser.parse_args()

    print_catalog()
    if args.probe:
        print("\n== Probing (loads the model, writes generated_audio/probe_*.wav) ==")
        return probe()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
