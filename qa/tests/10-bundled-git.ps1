# Test: Bundled Git for Windows (dugite-native) works via the dashboard.
# See change: embed-git-bash-on-windows.
#
# Verifies the bundled git/sh ship and RUN when windowsGitSource=bundled,
# proving fresh-Windows-without-Git-for-Windows users get a working agent.
# A real host-git uninstall is destructive and out of scope; forcing the
# "bundled" setting exercises the same code path (selectGitSource → bundled
# → ensureBundledGitOnPath) and the same bundled binaries.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Bundled git on Windows ==="

function Get-Health {
    return Invoke-RestMethod -Uri "http://localhost:8000/api/health" -TimeoutSec 5
}

# 1. Server up
try {
    $h = Get-Health
    if (-not $h.ok) { Write-Host "FAIL: Server not healthy"; exit 1 }
} catch {
    Write-Host "FAIL: Server not running ($_)"; exit 1
}

# 2. gitSource block must be present on a Windows server
if ($null -eq $h.gitSource) {
    Write-Host "FAIL: /api/health has no gitSource block (Windows-only field missing)"
    exit 1
}
Write-Host "Initial git source: $($h.gitSource.source) ($($h.gitSource.setting))"

$origSetting = $h.gitSource.setting

try {
    # 3. Force bundled
    # `pi-dashboard api` mints local proof (a bare POST is refused by the strict `requireLocalProof` default).
    $null = & pi-dashboard api POST /api/config --data ((@{ windowsGitSource = "bundled" } | ConvertTo-Json -Compress) -replace '"','\"')
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: POST /api/config exited $LASTEXITCODE"; exit 1 }
    Start-Sleep -Seconds 1

    $h2 = Get-Health
    $gs = $h2.gitSource
    if ($gs.source -ne "bundled") {
        Write-Host "FAIL: expected source=bundled, got $($gs.source)"
        exit 1
    }
    if (-not $gs.gitPath -or ($gs.gitPath -notmatch "resources[\\/]git")) {
        Write-Host "FAIL: bundled gitPath not under resources/git: $($gs.gitPath)"
        exit 1
    }
    if (-not (Test-Path $gs.gitPath)) {
        Write-Host "FAIL: bundled git.exe not on disk: $($gs.gitPath)"
        exit 1
    }
    if (-not $gs.gitVersion -or ($gs.gitVersion -notmatch "git version")) {
        Write-Host "FAIL: bundled git did not report a version: '$($gs.gitVersion)'"
        exit 1
    }
    Write-Host "Bundled git runs: $($gs.gitVersion)"
    Write-Host "Bundled git path: $($gs.gitPath)"

    # 4. Bundled POSIX shell present + runs (pi's !/!! use pi.exec('sh'))
    if (-not $gs.shellPath -or -not (Test-Path $gs.shellPath)) {
        Write-Host "FAIL: bundled shell missing: $($gs.shellPath)"
        exit 1
    }
    $shVer = & $gs.shellPath --version 2>&1 | Select-Object -First 1
    if ($shVer -notmatch "bash") {
        Write-Host "FAIL: bundled sh.exe did not report bash: '$shVer'"
        exit 1
    }
    Write-Host "Bundled shell runs: $shVer"

    # 5. git status via the bundled binary in a scratch repo
    $testDir = Join-Path $env:TEMP ("qa-bundled-git-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $testDir -Force | Out-Null
    Push-Location $testDir
    try {
        & $gs.gitPath init | Out-Null
        $status = & $gs.gitPath status 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FAIL: bundled 'git status' exited $LASTEXITCODE"
            exit 1
        }
        Write-Host "Bundled 'git status' OK"
    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $testDir -ErrorAction SilentlyContinue
    }

    Write-Host "PASS: bundled git + sh present and runnable"
} finally {
    # Restore original setting
    $null = & pi-dashboard api POST /api/config --data ((@{ windowsGitSource = $origSetting } | ConvertTo-Json -Compress) -replace '"','\"')
}
