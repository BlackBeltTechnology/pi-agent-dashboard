# Test: the bridge's process scan never lists the dashboard server it auto-started.
#
# test-plan #X11 (L2, Windows twin of 38-poll-cost.sh; change: optimize-polling-hot-paths).
# The Windows scan now applies `excludedPgids` by PID, closing the gap where the
# self-spawned dashboard server could surface in a session's process list.
#
# PRECONDITION (the QA harness provides it): a pi session was started WITHOUT a
# running dashboard, so its bridge auto-started the server being tested. This
# script cannot make that happen itself; it FAILS (never passes vacuously) when
# it cannot establish that a bridge session exists and has actually scanned at
# least twice. Reads each session's process list from the session surface.

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

# Wait (bounded) until some session's bridge reports >= 2 completed scans: two
# fast Windows cycles are 2 x 10 s, plus slack for the first one-shot.
$scanned = $null
for ($i = 0; $i -lt 18; $i++) {
  $h = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10
  $scanned = @($h.agents) | Where-Object { $_.pollProcScanRuns -ge 2 } | Select-Object -First 1
  if ($scanned) { break }
  Start-Sleep -Seconds 5
}
if (-not $scanned) {
  Write-Error "FAIL: no live session reported >= 2 process scans (pollProcScanRuns) - the X11 precondition (an auto-started bridge session) is not established"
  exit 1
}

$sessions = Invoke-RestMethod -Uri "http://localhost:$port/api/sessions" -TimeoutSec 10
$list = if ($sessions.data) { $sessions.data } else { $sessions }
$mine = @($list) | Where-Object { $_.id -eq $scanned.sessionId } | Select-Object -First 1
if (-not $mine) {
  Write-Error "FAIL: the scanning session $($scanned.sessionId) is not on the session surface"
  exit 1
}
foreach ($p in @($mine.processes)) {
  if ($p.pid -eq $serverPid) {
    Write-Error "FAIL: session $($mine.id) lists the dashboard server PID $serverPid in its process list"
    exit 1
  }
}
Write-Host "OK: session $($mine.id) scanned $($scanned.pollProcScanRuns) times and never lists the dashboard server PID $serverPid"
