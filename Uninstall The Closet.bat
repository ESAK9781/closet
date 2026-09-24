@echo off
title The Closet - uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\uninstall.ps1"
echo.
pause
