# LonesCode IDE - Optimized Release Script
# Usage: powershell -ExecutionPolicy Bypass -File tools/release-optimized.ps1 [-BumpVersion patch|minor|major] [-LocalOnly]
# 
# By default: bumps patch version, builds on GitHub Actions (Win/Mac/Linux), creates release
# Use -LocalOnly to build only Windows locally

param(
    [ValidateSet('patch', 'minor', 'major', '')]
    [string]$BumpVersion = 'patch',
    [switch]$SkipBuild,
    [switch]$Draft,
    [switch]$Force,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Speeds up downloads

$ProjectRoot = Join-Path $PSScriptRoot '..'
$DistDir = Join-Path $ProjectRoot 'dist'

# Find gh.exe (GitHub CLI) - check common install locations
$GhExe = $null
$ghPaths = @(
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\gh\bin\gh.exe",
    "$env:USERPROFILE\scoop\shims\gh.exe",
    "$env:ChocolateyInstall\bin\gh.exe"
)
foreach ($p in $ghPaths) {
    if (Test-Path $p) { $GhExe = $p; break }
}
if (-not $GhExe) {
    # Try PATH as fallback
    $GhExe = (Get-Command gh -ErrorAction SilentlyContinue).Source
}
if (-not $GhExe) {
    throw "GitHub CLI (gh) not found. Install from: https://cli.github.com/"
}

# Colors for output
function Write-Success($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[..] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[!!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[ERR] $msg" -ForegroundColor Red }

# Check required tools
function Test-Prerequisites {
    $required = @('node', 'npm', 'git')
    $missing = @()
    
    foreach ($cmd in $required) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            $missing += $cmd
        }
    }
    
    if ($missing.Count -gt 0) {
        throw "Missing required tools: $($missing -join ', ')"
    }
    
    # Check GitHub CLI auth
    $ghAuth = & $GhExe auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI not authenticated. Run: & '$GhExe' auth login"
    }
    
    Write-Success "All prerequisites checked (gh: $GhExe)"
}

# Get/Set package.json version
function Get-PackageVersion {
    $pkgPath = Join-Path $ProjectRoot 'package.json'
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    return $pkg.version
}

function Set-PackageVersion($newVersion) {
    $pkgPath = Join-Path $ProjectRoot 'package.json'
    $content = Get-Content $pkgPath -Raw
    # Use regex to replace version to preserve formatting
    $content = $content -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$newVersion`""
    # Write without BOM
    [System.IO.File]::WriteAllText($pkgPath, $content)
    Write-Success "Version updated to $newVersion"
}

function Bump-Version($type) {
    $current = Get-PackageVersion
    $parts = $current -split '\.'
    
    switch ($type) {
        'major' { $parts[0] = [int]$parts[0] + 1; $parts[1] = 0; $parts[2] = 0 }
        'minor' { $parts[1] = [int]$parts[1] + 1; $parts[2] = 0 }
        'patch' { $parts[2] = [int]$parts[2] + 1 }
    }
    
    $newVersion = $parts -join '.'
    Set-PackageVersion $newVersion
    return $newVersion
}

# Check if release already exists
function Test-ReleaseExists($tag) {
    $ErrorActionPreference = 'SilentlyContinue'
    $null = & $GhExe release view $tag 2>&1
    $result = $LASTEXITCODE -eq 0
    $ErrorActionPreference = 'Stop'
    return $result
}

# Check if tag exists
function Test-TagExists($tag) {
    $existing = git tag --list $tag | Out-String
    return -not [string]::IsNullOrWhiteSpace($existing)
}

# Generate changelog from commits since last tag
function Get-Changelog {
    $ErrorActionPreference = 'SilentlyContinue'
    $lastTag = git describe --tags --abbrev=0 2>&1
    if ($LASTEXITCODE -ne 0) { $lastTag = $null }
    $ErrorActionPreference = 'Stop'
    
    if ($lastTag) {
        $commits = git log "$lastTag..HEAD" --pretty=format:"- %s" --no-merges 2>$null
    } else {
        $commits = git log --pretty=format:"- %s" --no-merges -20 2>$null
    }
    
    if ([string]::IsNullOrWhiteSpace($commits)) {
        return "Initial release"
    }
    
    $repoName = & $GhExe repo view --json nameWithOwner -q .nameWithOwner 2>$null
    if ($lastTag) {
        $changelog = "## What's Changed`n`n$commits`n`n**Full Changelog**: https://github.com/$repoName/compare/$lastTag...v$(Get-PackageVersion)"
    } else {
        $changelog = "## Initial Release`n`n$commits"
    }
    return $changelog
}

# Install dependencies (with caching check)
function Install-Dependencies {
    Write-Info "Checking dependencies..."
    
    $nodeModules = Join-Path $ProjectRoot 'node_modules'
    $packageLock = Join-Path $ProjectRoot 'package-lock.json'
    
    # Skip if node_modules is fresh
    if ((Test-Path $nodeModules) -and (Test-Path $packageLock)) {
        $lockTime = (Get-Item $packageLock).LastWriteTime
        $modulesTime = (Get-Item $nodeModules).LastWriteTime
        
        if ($modulesTime -gt $lockTime) {
            Write-Success "Dependencies up to date (cached)"
            return
        }
    }
    
    Push-Location $ProjectRoot
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        npm ci --prefer-offline 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            npm install 2>&1 | Out-Null
        }
        $ErrorActionPreference = 'Stop'
        Write-Success "Dependencies installed"
    }
    finally {
        Pop-Location
    }
}

# Build for Windows
function Build-Windows {
    Write-Info "Building Windows artifacts..."
    
    Push-Location $ProjectRoot
    try {
        # Build both NSIS installer and portable
        npx electron-builder --win --config.compression=maximum
        if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
        Write-Success "Windows build complete"
    }
    finally {
        Pop-Location
    }
}

# Build for Linux (optional, may fail on Windows)
function Build-Linux {
    Write-Info "Building Linux artifacts..."
    
    Push-Location $ProjectRoot
    try {
        npx electron-builder --linux 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Linux build complete"
        } else {
            Write-Warn "Linux build skipped (requires Linux/Docker)"
        }
    }
    finally {
        Pop-Location
    }
}

# Clean dist folder
function Clean-Dist {
    if (Test-Path $DistDir) {
        Remove-Item -Path $DistDir -Recurse -Force
        Write-Success "Cleaned dist folder"
    }
}

# Get release artifacts
function Get-Artifacts {
    $artifacts = @()
    
    # Windows installers
    $artifacts += Get-ChildItem -Path $DistDir -Filter "*.exe" -ErrorAction SilentlyContinue
    
    # Linux packages
    $artifacts += Get-ChildItem -Path $DistDir -Filter "*.AppImage" -ErrorAction SilentlyContinue
    $artifacts += Get-ChildItem -Path $DistDir -Filter "*.deb" -ErrorAction SilentlyContinue
    
    # Blockmap and yml files (for auto-update)
    $artifacts += Get-ChildItem -Path $DistDir -Filter "latest*.yml" -ErrorAction SilentlyContinue
    
    return $artifacts | Where-Object { $_ -ne $null }
}

# Create GitHub release
function New-GitHubRelease($tag, $changelog) {
    Write-Info "Creating GitHub release $tag..."
    
    $artifacts = Get-Artifacts
    
    if ($artifacts.Count -eq 0) {
        throw "No artifacts found in dist/ folder"
    }
    
    Write-Info "Found $($artifacts.Count) artifacts to upload"
    
    # Create tag if needed
    if (-not (Test-TagExists $tag)) {
        Push-Location $ProjectRoot
        git tag $tag
        git push origin $tag
        Pop-Location
        Write-Success "Created and pushed tag $tag"
    }
    
    # Build gh release command
    $artifactPaths = $artifacts | ForEach-Object { $_.FullName }
    
    $releaseArgs = @('release', 'create', $tag)
    $releaseArgs += $artifactPaths
    $releaseArgs += '--title', "LonesCode IDE $tag"
    $releaseArgs += '--notes', $changelog
    
    if ($Draft) {
        $releaseArgs += '--draft'
    }
    
    Push-Location $ProjectRoot
    try {
        & $GhExe $releaseArgs
        if ($LASTEXITCODE -ne 0) { throw "Failed to create release" }
        Write-Success "Release $tag created successfully!"
    }
    finally {
        Pop-Location
    }
}

# Main execution
function Main {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Magenta
    Write-Host "    LonesCode IDE - Release Builder     " -ForegroundColor Magenta
    Write-Host "=========================================" -ForegroundColor Magenta
    Write-Host ""
    
    try {
        # Step 1: Prerequisites
        Test-Prerequisites
        
        # Step 2: Bump version if requested
        if ($BumpVersion) {
            $version = Bump-Version $BumpVersion
            
            # Commit version change
            Push-Location $ProjectRoot
            git add package.json
            git commit -m "chore: bump version to $version"
            git push
            Pop-Location
        }
        
        $version = Get-PackageVersion
        $tag = "v$version"
        
        Write-Info "Preparing release $tag"
        
        # Step 3: Check if release exists
        if ((Test-ReleaseExists $tag) -and -not $Force) {
            throw "Release $tag already exists. Use -Force to overwrite or bump version with -BumpVersion"
        }
        
        # Use GitHub Actions for cross-platform build (default)
        if (-not $LocalOnly) {
            Write-Info "Triggering GitHub Actions for cross-platform build (Win/Mac/Linux)..."
            
            # Create and push tag to trigger workflow
            Push-Location $ProjectRoot
            if (-not (Test-TagExists $tag)) {
                git tag $tag
                git push origin $tag
                Write-Success "Tag $tag pushed - GitHub Actions started!"
            } else {
                # Trigger workflow manually
                & $GhExe workflow run release.yml -f version=$version
                Write-Success "GitHub Actions workflow triggered"
            }
            Pop-Location
            
            $stopwatch.Stop()
            Write-Host ""
            Write-Success "Release $tag initiated in $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s"
            Write-Host ""
            Write-Host "GitHub Actions is now building for Windows, macOS, and Linux" -ForegroundColor Cyan
            Write-Host ""
            
            $repoUrl = & $GhExe repo view --json url -q .url 2>$null
            Write-Host "Monitor build: $repoUrl/actions" -ForegroundColor Blue
            Write-Host "Release page:  $repoUrl/releases/tag/$tag" -ForegroundColor Blue
            return
        }
        
        # LOCAL BUILD MODE (Windows only)
        Write-Warn "Local mode: Building Windows only"
        
        # Step 4: Install dependencies
        Install-Dependencies
        
        # Step 5: Build locally (Windows only)
        if (-not $SkipBuild) {
            Clean-Dist
            Build-Windows
        }
        
        # Step 6: Generate changelog
        $changelog = Get-Changelog
        
        # Step 7: Create release
        New-GitHubRelease $tag $changelog
        
        $stopwatch.Stop()
        Write-Host ""
        Write-Success "Release completed in $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s"
        
        # Show release URL
        $repoUrl = & $GhExe repo view --json url -q .url 2>$null
        if ($repoUrl) {
            Write-Host ""
            Write-Host "Release URL: $repoUrl/releases/tag/$tag" -ForegroundColor Blue
        }
    }
    catch {
        Write-Err $_.Exception.Message
        exit 1
    }
}

Main
