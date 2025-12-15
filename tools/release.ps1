# One-click build and release for LonesCode IDE (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File tools/release.ps1

$ErrorActionPreference = 'Stop'

function Ensure-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' is not available in PATH."
  }
}

function Get-PackageJsonVersion() {
  $pkgPath = Join-Path $PSScriptRoot '..' 'package.json'
  $pkgJson = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if (-not $pkgJson.version) { throw 'package.json missing version' }
  return $pkgJson.version
}

function Ensure-Author() {
  $pkgPath = Join-Path $PSScriptRoot '..' 'package.json'
  $json = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if (-not $json.author -or $json.author -eq '') {
    $json.author = $env:USERNAME
    $json | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $pkgPath
    Write-Host "Set package.json author to '$($env:USERNAME)'"
  }
}

# Preconditions
Ensure-Command node
Ensure-Command npm
Ensure-Command git
Ensure-Command gh

Push-Location (Join-Path $PSScriptRoot '..')
try {
  # Install deps
  Write-Host 'Installing dependencies...'
  npm install | Out-Null
  npm install --save-dev electron electron-builder | Out-Null

  # Ensure author present
  Ensure-Author

  # Build Windows artifacts
  Write-Host 'Building Windows artifacts...'
  npx electron-builder --win

  # Determine version and create tag + release
  $version = Get-PackageJsonVersion
  $tag = "v$version"
  Write-Host "Tagging and creating GitHub release $tag"

  # Create tag locally if missing
  $existingTag = git tag --list $tag | Out-String
  if ([string]::IsNullOrWhiteSpace($existingTag)) {
    git tag $tag
    git push origin $tag
  }

  # Create release and upload dist/*
  gh release create $tag dist/* --title "LonesCode IDE $tag" --notes "Auto-generated release"
  Write-Host 'Release created successfully.'
}
finally {
  Pop-Location
}