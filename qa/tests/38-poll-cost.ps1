# Test: the bridge's process scan never lists the dashboard server it auto-started.
#
# test-plan #X11 (L2, Windows twin of 38-poll-cost.sh; change: optimize-polling-hot-paths).
# The Windows scan now applies `excludedPgids` by PID, closing the gap where the
# self-spawned dashboard server could surface in a session's process list.
# Reads the session surface after two scan cycles (10 s fast cadence x 2).

$ErrorActionPreference = "Stop"

Write-Host "=== Test: Windows self-spawn exclusion (X11) ==="

$port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { "8000" }

try {
  $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10
} catch {
  Write-Error "FAIL: Server not running (health request failed)"
  exit 1
}
$serverPid = $health.pid

# Two fast scan cycles, plus slack for the first one-shot.
Start-Sleep -Seconds 30

$sessions = Invoke-RestMethod -Uri "http://localhost:$port/api/sessions" -TimeoutSec 10
$list = if ($sessions.data) { $sessions.data } else { $sessions }
foreach ($s in $list) {
  foreach ($p in @($s.processes)) {
    if ($p.pid -eq $serverPid) {
      Write-Error "FAIL: session $($s.id) lists the dashboard server PID $serverPid in its process list"
      exit 1
    }
  }
}
Write-Host "OK: the dashboard server PID $serverPid is absent from every session's process list"
