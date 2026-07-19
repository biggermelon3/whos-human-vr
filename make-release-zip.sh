#!/usr/bin/env bash
# ============================================================
#  make-release-zip.sh -- assemble the one-download FILE-mode package
#  (launchers + who-is-human server + your build) into a single zip, ready
#  to attach to a GitHub Release. Mirrors the Windows package layout.
#
#  Usage:
#    ./make-release-zip.sh <platform> <build-dir> [out-dir]
#      platform   windows | macos | linux   (used in the zip name only)
#      build-dir  the Unity build OUTPUT folder (the one holding WhosHuman.app
#                 or WhosHuman.exe, plus its *_Data / DoNotShip siblings)
#      out-dir    where to write the zip (default: current dir)
#
#  Example (macOS):
#    cd who-is-human && npm install && cd ..        # mac-native server deps
#    ./make-release-zip.sh macos "UnityVr/MacBuild"
#    gh release upload v0.1.0 whos-human-macos-file-mode.zip
#
#  Needs `zip` (built in on macOS/Linux). On Windows use the PowerShell path
#  in the README instead -- the Windows build is already on the Release.
# ============================================================
set -euo pipefail

PLATFORM="${1:?usage: make-release-zip.sh <windows|macos|linux> <build-dir> [out-dir]}"
BUILD="${2:?need the Unity build OUTPUT folder (holds the .app/.exe)}"
OUT="${3:-.}"
DIR="$(cd "$(dirname "$0")" && pwd)"   # repo root (this script lives here)

[ -d "$BUILD" ] || { echo "[X] build dir not found: $BUILD"; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "[X] 'zip' not found. Install it, or use the README's PowerShell path on Windows."; exit 1; }

NAME="whos-human-$PLATFORM-file-mode"
TMP="$(mktemp -d)"
STAGE="$TMP/$NAME"
mkdir -p "$STAGE/game"

# 1) launchers at the zip root
cp "$DIR"/play-file-mode.bat "$DIR"/play-file-mode.ps1 "$DIR"/play-file-mode.sh \
   "$DIR"/play-file-mode.command "$DIR"/stop-file-mode.command "$STAGE/"

# 2) server, minus logs / transient workspace / any real .env
cp -r "$DIR/who-is-human" "$STAGE/who-is-human"
rm -rf "$STAGE/who-is-human/logs" "$STAGE/who-is-human/agent-workspace" "$STAGE/who-is-human/.env"
[ -d "$STAGE/who-is-human/node_modules" ] || \
  echo "[!] who-is-human/node_modules missing -- run 'npm install' there first, or the player's first run will."

# 3) build -> game/, skipping Unity's 'do not ship' folders (never bundle those)
shopt -s dotglob
for item in "$BUILD"/*; do
  base="$(basename "$item")"
  case "$base" in
    *_BackUpThisFolder_ButDontShipItWithYourGame|*_BurstDebugInformation_DoNotShip) continue ;;
  esac
  cp -r "$item" "$STAGE/game/"
done
shopt -u dotglob

# 4) zip
ZIP="$(cd "$OUT" && pwd)/$NAME.zip"
rm -f "$ZIP"
( cd "$TMP" && zip -qr "$ZIP" "$NAME" )
rm -rf "$TMP"

echo "built: $ZIP  ($(du -h "$ZIP" | cut -f1))"
echo "upload:  gh release upload v0.1.0 \"$ZIP\""
