@echo off
:: Quick Release - One double-click to release for ALL platforms
:: Bumps version, triggers GitHub Actions build for Win/Mac/Linux

cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File tools/release-optimized.ps1
pause
