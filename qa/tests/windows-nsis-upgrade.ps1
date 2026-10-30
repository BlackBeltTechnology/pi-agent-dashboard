# Test: NSIS upgrade from the PREVIOUS release keeps exactly the node_modules bridge extension registered.
#
# The bundle ships the workspace source once, under resources\server\node_modules\@blackbelt-technology\;
# `resources\server\packages\<dir>` is gone. A user upgrading from a release that registered
# `...\resources\server\packages\extension` in ~/.pi/agent/settings.json must end up with the new path only.
#
# Flow: previous Setup.exe /S -> start+stop the app -> new Setup.exe /S over it -> start the app once ->
#       assert the install tree and ~/.pi/agent/settings.json `packages`.
#
# Usage: windows-nsis-upgrade.ps1 -Setup <new Setup.exe> [-PreviousSetup <path-or-url-to-previous Setup.exe>]
#   Without -PreviousSetup the latest published release's x64 Setup.exe is fetched with `gh release download`
#   (needs GH_TOKEN + GH_REPO). No published release -> SKIP (exit 0).
# See change: slim-windows-install-file-count (test-plan X4).
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$PreviousSetup,
    [int]$RegisterTimeoutSec = 90
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== Test: NSIS upgrade from the previous release ==="

$installDir = Join-Path $env:LOCALAPPDATA "Programs\PI Dashboard"
$settingsPath = Join-Path $env:USERPROFILE ".pi\agent\settings.json"
$legacyExt = Join-Path $installDir "resources\server\packages\extension"
$newExt = Join-Path $installDir "resources\server\node_modules\@blackbelt-technology\pi-dashboard-extension"

function Read-Packages {
    if (-not (Test-Path $settingsPath)) { return @() }
    $raw = (Get-Content $settingsPath -Raw -ErrorAction SilentlyContinue)
    if (-not $raw) { return @() }
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.packages) { return @() }
    return @($j.packages | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.source } })
}

function Start-AppOnce([string]$Label) {
    $exe = Join-Path $installDir "pi-dashboard.exe"
    if (-not (Test-Path $exe)) { Write-Host "FAIL: $exe not found ($Label)"; exit 1 }
    $p = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "pi-upg-$Label-out.log") -RedirectStandardError (Join-Path $env:TEMP "pi-upg-$Label-err.log")
    return $p
}

function Stop-App($p) {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    # The Electron shell spawns the dashboard server detached; release the install dir before the next install.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# ── previous release ────────────────────────────────────────────────────────
if (-not $PreviousSetup) {
    $dl = Join-Path $env:TEMP "pi-previous-release"
    New-Item -ItemType Directory -Force -Path $dl | Out-Null
    & gh release download --pattern "PI-Dashboard-Setup-*-x64.exe" --dir $dl --clobber 2>&1 | Write-Host
    $prev = Get-ChildItem $dl -Filter "PI-Dashboard-Setup-*-x64.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $prev) {
        Write-Host "SKIP: no published release with an x64 Setup.exe (first release?)"
        exit 0
    }
    $PreviousSetup = $prev.FullName
}
Write-Host "Previous release installer: $PreviousSetup"

# ── 1. install the previous release, run it once ────────────────────────────
& (Join-Path $here "windows-nsis-install.ps1") -Setup $PreviousSetup
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: previous release did not install"; exit 1 }

$oldApp = Start-AppOnce "old"
Start-Sleep -Seconds 20
Stop-App $oldApp

# The previous app registers `...\server\packages\extension` on every start. A GitHub-hosted runner has
# no interactive desktop, so the GUI shell may never get that far: seed the state a real upgrader has.
$before = @(Read-Packages)
if (-not ($before | Where-Object { $_ -ieq $legacyExt })) {
    Write-Host "NOTE: previous app did not register itself headlessly; seeding the legacy registration"
    $dir = Split-Path -Parent $settingsPath
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $obj = if (Test-Path $settingsPath) { (Get-Content $settingsPath -Raw | ConvertFrom-Json) } else { [pscustomobject]@{} }
    $pk = @($before) + @($legacyExt)
    $obj | Add-Member -NotePropertyName packages -NotePropertyValue $pk -Force
    $obj | ConvertTo-Json -Depth 10 | Out-File -FilePath $settingsPath -Encoding utf8
}
Write-Host "Before upgrade, packages: $((Read-Packages) -join '; ')"

# ── 2. upgrade in place ─────────────────────────────────────────────────────
& (Join-Path $here "windows-nsis-install.ps1") -Setup $Setup
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: new Setup.exe did not install over the previous release"; exit 1 }

# Install tree: the second copy is gone, the canonical one is there.
if (Test-Path $legacyExt) { Write-Host "FAIL: stale $legacyExt survived the upgrade"; exit 1 }
if (-not (Test-Path (Join-Path $newExt "package.json"))) { Write-Host "FAIL: $newExt\package.json missing after the upgrade"; exit 1 }
$leftover = @(Get-ChildItem (Join-Path $installDir "resources\server\packages") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "dist" })
if ($leftover.Count -gt 0) { Write-Host "FAIL: leftover resources\server\packages\* after the upgrade: $($leftover.Name -join ', ')"; exit 1 }
Write-Host "Install tree OK (no packages\<dir> copy, node_modules extension present)"

# ── 3. start the new app once; the shell re-points the registration ─────────
$newApp = Start-AppOnce "new"
$ok = $false
try {
    for ($i = 0; $i -lt $RegisterTimeoutSec; $i++) {
        Start-Sleep -Seconds 1
        $pk = @(Read-Packages)
        $hasNew = [bool]($pk | Where-Object { $_ -ieq $newExt })
        $hasLegacy = [bool]($pk | Where-Object { $_ -match '[\\/]packages[\\/]extension$' })
        if ($hasNew -and -not $hasLegacy) { $ok = $true; break }
        if ($newApp.HasExited) { Write-Host "Electron process exited early (code $($newApp.ExitCode)) after ${i}s"; break }
    }
    # /api/health is informational: GitHub-hosted runners have no desktop session (see the NSIS smoke step).
    try {
        $h = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 3
        Write-Host "health: HTTP $($h.StatusCode)"
    } catch { Write-Host "health: not reachable (informational)" }
} finally {
    Stop-App $newApp
}

if (-not $ok) {
    Write-Host "FAIL: after the upgrade, settings.json packages should contain $newExt and no packages\extension entry"
    Write-Host "packages: $((Read-Packages) -join '; ')"
    foreach ($f in @("pi-upg-new-out.log", "pi-upg-new-err.log")) {
        $lp = Join-Path $env:TEMP $f
        if (Test-Path $lp) { Write-Host "--- $f ---"; Get-Content $lp -Tail 40 }
    }
    exit 1
}
Write-Host "PASS: upgrade keeps exactly the node_modules bridge extension registered"
