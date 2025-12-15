@echo off
:: Quick Release - One double-click to release
:: Just double-click this file to create a new patch release

cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File tools/release-optimized.ps1 -BumpVersion patch
pause
