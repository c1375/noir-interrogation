@echo off
REM ============================================================
REM  Noir Interrogation -- one-click launcher (Windows)
REM  Double-click this file. It starts a local web server,
REM  opens the game in your default browser, and stays open
REM  while you play. Close THIS window to stop the server.
REM ============================================================

title Noir Interrogation -- close this window to stop server

REM cd to the script's own directory, then into web/
cd /d "%~dp0web"

set PORT=8765

echo.
echo  ====================================================
echo    Noir Interrogation
echo  ====================================================
echo.
echo    Server:  http://localhost:%PORT%/
echo    Browser: opens automatically in a moment...
echo    Stop:    close THIS window (or press Ctrl+C)
echo.
echo  ====================================================
echo.

REM Verify Python is installed and on PATH.
python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed or not on PATH.
  echo.
  echo Install Python 3.7+ from https://www.python.org/downloads/
  echo (be sure to check "Add Python to PATH" during installation)
  echo.
  pause
  exit /b 1
)

REM Open the browser via PowerShell (small async delay so the server
REM has time to bind the port first). Using -WindowStyle Hidden so no
REM extra console window flashes.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:%PORT%/'"

REM Run the static server (this blocks until window/process is closed).
python -m http.server %PORT%

REM If the server exits on its own (e.g. port-in-use error), pause so the
REM user can read the message before the window closes.
echo.
echo Server stopped.
pause
