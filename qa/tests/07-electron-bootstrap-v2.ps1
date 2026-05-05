# Test: Electron Windows ZIP — V2 LaunchSource bootstrap end-to-end.
#
# Drives the actual production failure mode the user hit on Windows 11 24H2:
# extract the .zip, launch pi-dashboard.exe, wait for /api/health, verify
# managed dir layout. Catches Windows-specific path semantics (drive letters,
# \ vs /, junction points) that Linux Docker can't see.
#
# Expects the ZIP at C:\qa-artifacts\PI-Dashboard-win32-x64.zip
# (run-test.sh uploads it via scp before invoking the test runner).
# Skips with a clear reason when the artifact is absent.
#
# See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Electron ZIP V2 bootstrap end-to-end ==="

$ZipPath = "C:\qa-artifacts\PI-Dashboard-win32-x64.zip"
$ExtractDir = "C:\PI-Dashboard-test"
$ManagedDir = Join-Path $env:USERPROFILE ".pi-dashboard"
$Port = 8112
$HealthUrl = "http://localhost:$Port/api/health"
$BootTimeoutSec = 180

if (-not (Test-Path $ZipPath)) {
    Write-Host "SKIP: artifact not found at $ZipPath"
    Write-Host "      (Upload via scp before running test, or pre-stage in VM build)"
    exit 0
}

# ── Stage 0: Clean prior state ────────────────────────────────────────────────
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
if (Test-Path $ManagedDir) { Remove-Item -Recurse -Force $ManagedDir }
Get-Process pi-dashboard -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# ── Stage 1: Extract ZIP ──────────────────────────────────────────────────────
Write-Host "Stage 1: extracting $ZipPath -> $ExtractDir"
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

# Forge produces nested PI-Dashboard-win32-x64\ inside the zip
$AppRoot = Get-ChildItem -Path $ExtractDir -Directory | Where-Object { $_.Name -like "PI-Dashboard-*" } | Select-Object -First 1
if (-not $AppRoot) {
    Write-Host "FAIL: no PI-Dashboard-* directory inside ZIP"
    exit 1
}
$AppExe = Join-Path $AppRoot.FullName "pi-dashboard.exe"
if (-not (Test-Path $AppExe)) {
    Write-Host "FAIL: pi-dashboard.exe not at $AppExe"
    exit 1
}
Write-Host "  pi-dashboard.exe: $AppExe"

# ── Stage 2: Verify resources layout ──────────────────────────────────────────
Write-Host "Stage 2: verify resources layout"
$Resources = Join-Path $AppRoot.FullName "resources"
$ServerBundle = Join-Path $Resources "server"
$BundleCli = Join-Path $ServerBundle "node_modules\@blackbelt-technology\pi-dashboard-server\src\cli.ts"
$OfflineManifest = Join-Path $Resources "offline-packages\manifest.json"
$BundledNode = Join-Path $Resources "node\node.exe"

foreach ($pair in @(
    @($ServerBundle,    "server bundle dir"),
    @($BundleCli,       "bundle cliPath"),
    @($OfflineManifest, "offline cacache manifest"),
    @($BundledNode,     "bundled node.exe")
)) {
    if (-not (Test-Path $pair[0])) {
        Write-Host "FAIL: $($pair[1]) missing at $($pair[0])"
        exit 1
    }
    Write-Host "  ✓ $($pair[1])"
}

# ── Stage 3: Launch pi-dashboard.exe ──────────────────────────────────────────
Write-Host "Stage 3: launch pi-dashboard.exe (port=$Port)"
$LogDir = Join-Path $env:USERPROFILE ".pi\dashboard"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$AppLog = Join-Path $LogDir "qa-test-app.log"
"" | Out-File -FilePath $AppLog -Encoding utf8

# Pass --port via DASHBOARD_PORT env var so the underlying server binds
# to our test port. Run as a background process; we'll kill it after the
# health check.
$AppProc = Start-Process -FilePath $AppExe `
    -PassThru `
    -RedirectStandardOutput $AppLog `
    -RedirectStandardError "$AppLog.err" `
    -WindowStyle Hidden

Write-Host "  Started PID $($AppProc.Id)"

# ── Stage 4: Wait for /api/health ─────────────────────────────────────────────
Write-Host "Stage 4: wait for /api/health (max ${BootTimeoutSec}s)"
$Deadline = (Get-Date).AddSeconds($BootTimeoutSec)
$Health = $null
$DefaultPort = 8000  # production default port; test ZIP doesn't take --port arg

# Try both the test port and the production-default port — the ZIP launches
# with whatever its config.json says (likely 8000) unless we plumb a port arg.
foreach ($P in @($DefaultPort, $Port)) {
    while ((Get-Date) -lt $Deadline -and -not $Health) {
        Start-Sleep -Seconds 2
        if ($AppProc.HasExited) {
            Write-Host "  pi-dashboard.exe exited (code=$($AppProc.ExitCode))"
            break
        }
        try {
            $Resp = Invoke-RestMethod -Uri "http://localhost:$P/api/health" -TimeoutSec 3 -ErrorAction Stop
            $Health = $Resp
            $UsedPort = $P
            break
        } catch { <# keep polling #> }
    }
    if ($Health) { break }
    if ($AppProc.HasExited) { break }
}

# ── Stage 5: Assertions ───────────────────────────────────────────────────────
$ExitCode = 0

if (-not $Health) {
    Write-Host "FAIL: /api/health did not respond within ${BootTimeoutSec}s"
    if (Test-Path $AppLog)        { Write-Host "  log: $(Get-Content $AppLog -Tail 30 -ErrorAction SilentlyContinue)" }
    if (Test-Path "$AppLog.err")  { Write-Host "  stderr: $(Get-Content "$AppLog.err" -Tail 30 -ErrorAction SilentlyContinue)" }
    $ExitCode = 1
} else {
    Write-Host "  ✓ /api/health responded on port $UsedPort"
    Write-Host "    starter=$($Health.starter) version=$($Health.version)"

    if ($Health.starter -ne "Electron") {
        Write-Host "FAIL: expected starter=Electron, got $($Health.starter)"
        $ExitCode = 1
    } else {
        Write-Host "  ✓ starter == Electron"
    }
}

# managedDir post-conditions
if (Test-Path $ManagedDir) {
    $VersionFile = Join-Path $ManagedDir ".version"
    if (Test-Path $VersionFile) {
        Write-Host "  ✓ managedDir/.version: $(Get-Content $VersionFile)"
    } else {
        Write-Host "FAIL: managedDir/.version missing"
        $ExitCode = 1
    }

    $PiCodingAgent = Join-Path $ManagedDir "node_modules\@mariozechner\pi-coding-agent\package.json"
    if (Test-Path $PiCodingAgent) {
        Write-Host "  ✓ pi-coding-agent installed in managedDir"
    } else {
        Write-Host "FAIL: pi-coding-agent not installed under managedDir"
        $ExitCode = 1
    }

    $ManagedCli = Join-Path $ManagedDir "node_modules\@blackbelt-technology\pi-dashboard-server\src\cli.ts"
    if (Test-Path $ManagedCli) {
        Write-Host "  ✓ managedDir cliPath survived install (no workspace-pruning regression)"
    } else {
        Write-Host "FAIL: managedDir cliPath missing — bundle merge step did not restore"
        $ExitCode = 1
    }

    # See change: expand-electron-qa-coverage.
    # Catches v0.4.6 spawnDetached stdio[1]='ignore' regression: a
    # successful spawn produced a 0-byte ~/.pi/dashboard/server.log.
    $ServerLog = Join-Path $env:USERPROFILE ".pi\dashboard\server.log"
    if (-not (Test-Path $ServerLog)) {
        Write-Host "FAIL: $ServerLog missing after successful spawn"
        $ExitCode = 1
    } elseif ((Get-Item $ServerLog).Length -eq 0) {
        Write-Host "FAIL: $ServerLog is 0 bytes after successful spawn (spawnDetached stdio regression?)"
        $ExitCode = 1
    } else {
        Write-Host "  ✓ server.log non-empty ($((Get-Item $ServerLog).Length) bytes)"
    }
} else {
    Write-Host "FAIL: managedDir was never created at $ManagedDir"
    $ExitCode = 1
}

# ── Stage 6: Cleanup ──────────────────────────────────────────────────────────
Write-Host "Stage 6: cleanup"
if (-not $AppProc.HasExited) {
    $AppProc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}
Get-Process pi-dashboard -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if ($ExitCode -eq 0) {
    Write-Host "PASS: V2 bootstrap completed end-to-end on Windows"
}
exit $ExitCode
