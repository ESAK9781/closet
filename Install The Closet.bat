@echo off
title The Closet - installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1" %*
echo.
pause
