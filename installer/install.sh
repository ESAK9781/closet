#!/usr/bin/env bash
# The Closet - macOS / Linux installer
#   ./installer/install.sh            install or repair
#   ./installer/install.sh --uninstall
# Creates <app>/.venv with the dependencies and adds a launcher:
#   macOS: ~/Desktop/The Closet.command     Linux: ~/.local/share/applications + ~/Desktop .desktop entry
# dump/ and metadata/ are never touched.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$APP/.venv"
DESKTOP="${XDG_DESKTOP_DIR:-$HOME/Desktop}"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$VENV" "$DESKTOP/The Closet.command" "$DESKTOP/the-closet.desktop" \
         "$HOME/.local/share/applications/the-closet.desktop"
  echo "Uninstalled. dump/ and metadata/ were kept."
  exit 0
fi

echo "The Closet - installer"
echo "  App folder: $APP"

PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
    PY="$(command -v "$c")"; break
  fi
done
if [[ -z "$PY" ]]; then
  echo "Python 3.10+ is required."
  if [[ "$(uname)" == "Darwin" ]]; then
    if command -v brew >/dev/null; then brew install python@3.12 && PY="$(brew --prefix)/bin/python3.12"
    else echo "Install it from https://www.python.org/downloads/ and run this again."; exit 1; fi
  elif command -v apt-get >/dev/null; then sudo apt-get update && sudo apt-get install -y python3 python3-venv && PY="$(command -v python3)"
  elif command -v dnf >/dev/null; then sudo dnf install -y python3 && PY="$(command -v python3)"
  else echo "Install Python 3.10+ with your package manager and run this again."; exit 1; fi
fi
echo "  Using $("$PY" --version) at $PY"

[[ -x "$VENV/bin/python" ]] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --disable-pip-version-check --quiet --upgrade pip
"$VENV/bin/python" -m pip install --disable-pip-version-check --quiet --upgrade -r "$APP/requirements.txt"
(cd "$APP" && "$VENV/bin/python" -c "import pymupdf, fastapi, uvicorn, numpy, scipy, dateutil, closet.extract") \
  || { echo "Install check failed."; exit 1; }
mkdir -p "$APP/dump"

LAUNCH="cd \"$APP\" && exec \"$VENV/bin/python\" run.py --exit-when-idle"
if [[ "$(uname)" == "Darwin" ]]; then
  printf '#!/bin/bash\n%s\n' "$LAUNCH" > "$DESKTOP/The Closet.command"
  chmod +x "$DESKTOP/The Closet.command"
  echo "  Desktop launcher: $DESKTOP/The Closet.command"
else
  mkdir -p "$HOME/.local/share/applications"
  ENTRY="[Desktop Entry]
Type=Application
Name=The Closet
Comment=Paperwork tracker
Exec=bash -c '$LAUNCH'
Icon=$APP/assets/closet.png
Terminal=false
Categories=Office;"
  echo "$ENTRY" > "$HOME/.local/share/applications/the-closet.desktop"
  if [[ -d "$DESKTOP" ]]; then
    echo "$ENTRY" > "$DESKTOP/the-closet.desktop"; chmod +x "$DESKTOP/the-closet.desktop"
    gio set "$DESKTOP/the-closet.desktop" metadata::trusted true 2>/dev/null || true
  fi
  echo "  Launcher added to your applications menu${DESKTOP:+ and desktop}."
fi

if [[ -d "$APP/.git" ]] && command -v git >/dev/null; then
  git -C "$APP" config core.hooksPath .githooks
  echo "  Git hook on: paperwork and metadata can't be committed."
fi
echo "The Closet is installed. Put paperwork PDFs in $APP/dump"
