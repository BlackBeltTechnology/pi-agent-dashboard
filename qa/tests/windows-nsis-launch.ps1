# Test: installed app launches and serves /api/health.
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

$proc = Start-Process -FilePath $exe -PassThru
try {
    $ok = $false
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { }
    }
    if (-not $ok) {
        Write-Host "FAIL: /api/health did not return 200 within ${TimeoutSec}s"
        exit 1
    }
    Write-Host "PASS: app launched and /api/health returned 200"
} finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
