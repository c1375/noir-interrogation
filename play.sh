#!/usr/bin/env bash
# ============================================================
#  Noir Interrogation -- one-click launcher (macOS / Linux)
#  Double-click (or run from terminal). Starts a local web
#  server, opens the game in your default browser, and stays
#  open while you play. Ctrl+C or close terminal to stop.
# ============================================================

set -e
cd "$(dirname "$0")/web"

PORT=8765

echo
echo "  ===================================================="
echo "    Noir Interrogation"
echo "  ===================================================="
echo
echo "    Server:  http://localhost:${PORT}/"
echo "    Browser: opens automatically in a moment..."
echo "    Stop:    Ctrl+C (or close this window)"
echo
echo "  ===================================================="
echo

if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  echo "[ERROR] Python is not installed."
  echo "Install Python 3.7+ from https://www.python.org/downloads/"
  exit 1
fi

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

# Open the browser shortly after we start serving.
( sleep 1
  if   command -v open    >/dev/null 2>&1; then open    "http://localhost:${PORT}/"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT}/"
  fi
) &

exec "$PY" -m http.server "$PORT"
