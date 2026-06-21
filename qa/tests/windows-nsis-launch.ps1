# Test: installed app launches and serves /api/health.
# On failure, dumps Electron stdout/stderr + the dashboard server log so CI
# shows WHY the server did not start (not just that it timed out).
# Usage: windows-nsis-launch.ps1 [-Dir <install dir>] [-Port <port>] [-TimeoutSec <n>]
param(
    [string]$Dir = (Join-Path $env:LOCALAPPDATA "Programs\PI Dashboard"),
    [int]$Port = 8000,
    [int]$TimeoutSec = 60
)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS-installed app launches and serves /api/health ==="

$exe = Join-Path $Dir "pi-dashboard.exe"
if (-not (Test-Path $exe)) {
    Write-Host "FAIL: $exe not found"
    exit 1
}

$outLog = Join-Path $env:TEMP "pi-dash-electron-out.log"
$errLog = Join-Path $env:TEMP "pi-dash-electron-err.log"
$serverLog = Join-Path $env:USERPROFILE ".pi\dashboard\server.log"

function Dump-Diagnostics {
    Write-Host "----- diagnostics -----"
    if ($proc) {
        $exited = $proc.HasExited
        Write-Host "Electron process: exited=$exited$(if ($exited) { " exitCode=$($proc.ExitCode)" })"
    }
    foreach ($pair in @(@{n="Electron stdout"; p=$outLog}, @{n="Electron stderr"; p=$errLog}, @{n="server.log"; p=$serverLog})) {
        if (Test-Path $pair.p) {
            $txt = Get-Content $pair.p -Tail 60 -ErrorAction SilentlyContinue
            Write-Host "--- $($pair.n) ($($pair.p)) ---"
            if ($txt) { $txt | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    (empty)" }
        } else {
            Write-Host "--- $($pair.n): not found at $($pair.p) ---"
        }
    }
    Write-Host "-----------------------"
}

$proc = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
try {
    $ok = $false
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { }
        # Fail fast if the Electron process already died.
        if ($proc.HasExited) {
            Write-Host "Electron process exited early (code $($proc.ExitCode)) after ${i}s"
            break
        }
    }
    if (-not $ok) {
        Write-Host "FAIL: /api/health did not return 200 within ${TimeoutSec}s"
        Dump-Diagnostics
        exit 1
    }
    Write-Host "PASS: app launched and /api/health returned 200"
} finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
