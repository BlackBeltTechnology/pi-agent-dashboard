# Test: tools on the inherited Windows `Path` resolve (#720 repro, test-plan #E27)
#
# Windows stores the variable as `Path`. Pre-fix, ToolResolver.buildSpawnEnv
# copied the env, read `base.PATH` (undefined) and wrote a new `PATH` holding
# only its prepends; Node's win32 spawn keeps `PATH` over `Path`, so the
# server started with a truncated PATH and `where tailscale` found nothing.
# A stub `tailscale.cmd` on a fresh temp dir prepended to `$env:Path` must
# therefore resolve through `GET /api/tools/tailscale`.
#
# See change: fix-windows-path-env-key-casing.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Windows Path key casing (#720) ==="

$stubDir = Join-Path $env:TEMP ("pi-path-casing-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stubDir | Out-Null
Set-Content -Path (Join-Path $stubDir "tailscale.cmd") -Value "@echo off`r`necho tailscale-stub" -Encoding ASCII
$env:Path = "$stubDir;$env:Path"

# Make sure no earlier server (started with the old PATH) answers instead.
try { pi-dashboard stop 2>$null } catch {}

$proc = Start-Process -FilePath "pi-dashboard" -ArgumentList "start" -PassThru -WindowStyle Hidden

try {
    $timeout = 30
    $elapsed = 0
    $ready = $false
    while ($elapsed -lt $timeout) {
        try {
            $health = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 2
            if ($health.StatusCode -eq 200) { $ready = $true; break }
        } catch {
            # Keep polling
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    if (-not $ready) {
        Write-Host "FAIL: Health endpoint did not respond HTTP 200 within ${timeout}s"
        exit 1
    }

    $res = Invoke-WebRequest -Uri "http://localhost:8000/api/tools/tailscale" -UseBasicParsing -TimeoutSec 10
    if ($res.StatusCode -ne 200) {
        Write-Host "FAIL: GET /api/tools/tailscale returned HTTP $($res.StatusCode)"
        exit 1
    }
    $body = $res.Content | ConvertFrom-Json
    $resolution = $body.data
    if (-not $resolution.ok) {
        Write-Host "FAIL: tailscale not resolved (ok=false) — the server's PATH lost the inherited Path entries (#720)"
        exit 1
    }
    if (-not $resolution.path -or -not $resolution.path.StartsWith($stubDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "FAIL: tailscale resolved to '$($resolution.path)', expected a path under $stubDir"
        exit 1
    }
    Write-Host "PASS: tailscale resolved from the inherited Path -> $($resolution.path)"
} finally {
    try { pi-dashboard stop 2>$null } catch {}
    if ($proc -and -not $proc.HasExited) {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item -Recurse -Force $stubDir -ErrorAction SilentlyContinue
}

exit 0
