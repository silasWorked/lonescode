@echo on
setlocal enabledelayedexpansion

:: One-click build and release for LonesCode IDE (Windows, .bat)
:: Usage: tools\release.bat

:: Check required commands
for %%C in (node npm git gh) do (
  where %%C >nul 2>&1 || (
    echo Required command '%%C' not found in PATH.
    exit /b 1
  )
)

:: Go to project root
pushd "%~dp0.." || exit /b 1

echo Current directory:
cd

:: Install dependencies
echo Installing dependencies...
call npm install || goto :fail
echo Installing dev build tools (electron, electron-builder)...
call npm install --save-dev electron electron-builder || goto :fail

:: Ensure author in package.json
for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json)"`) do set JSON=%%A
powershell -NoProfile -Command "
  $p = Get-Content 'package.json' -Raw | ConvertFrom-Json;
  if (-not $p.author -or $p.author -eq '') { $p.author = $env:USERNAME }
  $p | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 'package.json'
" || exit /b 1

:: Build artifacts (Windows + optional Linux)
echo Building Windows artifacts...
call npx electron-builder --win || goto :fail

echo Building Linux artifacts...
call npx electron-builder --linux || echo [WARN] Linux build failed or requires tooling; continuing...

:: Read version from package.json
for /f "usebackq tokens=*" %%V in (`powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"`) do set VERSION=%%V
set TAG=v%VERSION%

:: Create tag if missing and push
for /f "delims=" %%T in ('git tag --list %TAG%') do set EXIST=%%T
if not defined EXIST (
  git tag %TAG% || exit /b 1
  git push origin %TAG% || exit /b 1
)

:: Create GitHub release and upload artifacts
echo Creating GitHub release %TAG% ...
gh release create %TAG% dist/* --title "LonesCode IDE %TAG%" --notes "Auto-generated release (Win + Linux)" || goto :fail

echo Release created successfully.

popd
endlocal

echo Done.
goto :eof

:fail
echo [ERROR] Script failed. See output above for details.
exit /b 1
