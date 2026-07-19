"""Generate a single WAV from the command line (no server required).

Examples:
    python scripts/generate_sample.py --text "Hello, Agent." --voice af_heart
    python scripts/generate_sample.py --language zh-CN --voice zf_xiaoxiao \\
        --text "我认为四号玩家前后的说法存在矛盾。" --out zh.wav
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DEFAULT_LANGUAGE, DEFAULT_VOICE  # noqa: E402
from app.tts_service import KokoroTtsService, TtsError  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate one WAV via Kokoro")
    parser.add_argument("--text", required=True, help="text to synthesize")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--out", default="sample.wav", help="output WAV path")
    args = parser.parse_args()

    service = KokoroTtsService()
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        service.validate(voice=args.voice, language_id=args.language)
        elapsed = service.synthesize_to_file(
            text=args.text.strip(),
            voice=args.voice,
            language_id=args.language,
            speed=args.speed,
            out_path=out_path,
        )
    except TtsError as exc:
        print(f"ERROR [{exc.code}]: {exc.message}", file=sys.stderr)
        return 1

    print(f"Wrote {out_path} in {elapsed:.2f}s "
          f"(voice={args.voice}, language={args.language}, speed={args.speed}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
