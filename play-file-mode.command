#!/usr/bin/env bash
# Double-click launcher for macOS (Finder runs .command in Terminal).
# Just forwards to play-file-mode.sh in the same folder.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/play-file-mode.sh" "$@"
