# Test: the cross-site mutation gate refuses a browser Origin, and leaves
# header-less local tooling (the CLI, the pi-dashboard skill) untouched.
#
# The Windows twin of `32-origin-gate.sh`. Both halves are asserted on purpose:
# a gate that refused EVERYTHING would pass a refusal-only smoke while breaking
# every local client.
#
# `/api/ws-ticket` is the mutation under test because it is side-effect-free.
#
# See change: fix-ws-origin-cswsh (test-plan #X5 → task 5.1).

$ErrorActionPreference = "Stop"

$port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { "18870" }
$piPort = if ($env:PI_GATEWAY_PORT) { $env:PI_GATEWAY_PORT } else { "19870" }

Write-Host "=== Test: cross-site mutation gate (X5) ==="

if (-not (Get-Command pi-dashboard -ErrorAction SilentlyContinue)) {
  Write-Host "SKIP: pi-dashboard not on PATH"
  exit 0
}

$qaHome = Join-Path $env:TEMP "qa-origin-$PID"
$serverProc = $null

function Cleanup {
  if ($script:serverProc -and -not $script:serverProc.HasExited) {
    Stop-Process -Id $script:serverProc.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $script:qaHome) {
    Remove-Item -Recurse -Force $script:qaHome -ErrorAction SilentlyContinue
  }
}

trap { Cleanup; break }

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $qaHome ".pi\dashboard") | Out-Null
  $env:HOME = $qaHome
  $env:USERPROFILE = $qaHome

  $serverProc = Start-Process -FilePath "pi-dashboard" `
    -ArgumentList @("start", "--port", $port, "--pi-port", $piPort, "--no-tunnel") `
    -PassThru -WindowStyle Hidden

  $waited = 0
  $up = $false
  while ($waited -lt 90) {
    try {
      $h = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -TimeoutSec 3 -UseBasicParsing
      if ($h.StatusCode -eq 200) { $up = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
    $waited += 2
  }
  if (-not $up) { throw "FAIL: dashboard never started" }

  $body = '{"scope":"browser"}'

  # 1. Header-less local client — the shape every non-browser caller has.
  $ok = Invoke-WebRequest -Uri "http://localhost:$port/api/ws-ticket" -Method POST `
    -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
  if ($ok.StatusCode -ne 200) {
    throw "FAIL: header-less POST /api/ws-ticket returned $($ok.StatusCode) (expected 200)"
  }

  # 2. The same call from a hostile page.
  $status = 0
  try {
    $refused = Invoke-WebRequest -Uri "http://localhost:$port/api/ws-ticket" -Method POST `
      -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing `
      -Headers @{ "Origin" = "http://attacker.example" }
    $status = $refused.StatusCode
  } catch {
    $status = [int]$_.Exception.Response.StatusCode
  }
  if ($status -ne 403) {
    throw "FAIL: attacker-Origin POST /api/ws-ticket returned $status (expected 403)"
  }

  Write-Host "PASS: header-less mutation allowed, cross-site mutation refused with 403"
} finally {
  Cleanup
}
