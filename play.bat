@echo off
REM ============================================================
REM  Noir Interrogation -- one-click launcher (Windows)
REM  Double-click this file. It runs play.py which starts a
REM  local web server and opens the game in your default browser.
REM  Close THIS window to stop the server.
REM ============================================================

title Noir Interrogation -- close this window to stop server
cd /d "%~dp0"

REM Verify Python is available.
python --version >nul 2>&1
if errorlevel 1 (
  py --version >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Python is not installed or not on PATH.
    echo.
    echo Install Python 3.7+ from https://www.python.org/downloads/
    echo Be sure to tick "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
  ) else (
    py "%~dp0play.py"
    goto :end
  )
)

python "%~dp0play.py"

:end
echo.
pause
