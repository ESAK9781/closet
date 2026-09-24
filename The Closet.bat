@echo off
rem Console launcher (the desktop shortcut runs without a console window).
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" run.py %*
) else (
  echo The Closet isn't installed yet - running with the system Python. Use "Install The Closet.bat" to set it up.
  python run.py %*
)
