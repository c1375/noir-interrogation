#!/usr/bin/env bash
# ============================================================
#  Noir Interrogation -- one-click launcher (macOS / Linux)
#  Double-click (or run from terminal). Hands off to play.py
#  which starts the server + opens the browser.
#  Ctrl+C or close terminal to stop.
# ============================================================

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$(pwd)/play.py"
elif command -v python >/dev/null 2>&1; then
  exec python "$(pwd)/play.py"
else
  echo "[ERROR] Python is not installed."
  echo "Install Python 3.7+ from https://www.python.org/downloads/"
  exit 1
fi
