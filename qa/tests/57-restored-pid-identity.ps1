# Test: on Windows a restored headless-registry pid is verified by start time
# before any signal (`probeProcessStart(pid, {kind:"host"})`: PowerShell
# `Get-Process` `.StartTime`). It used to be `unverifiable` (no win32 probe).
#
# test-plan #X11 (now): a REAL decoy started now, seeded as an 8-day-old entry (a
#   pid recycled while the server was down) -> `identity mismatch ... kind=spawn`,
#   entry dropped, decoy never signalled (pre-change: kept as unverifiable).
# test-plan #X12: wired into the windows job of ci-gateway-platform.yml.
# add-windows-process-identity: a genuine orphan (entry newer than the decoy's
#   start) is now reclaimed at startup and killed by `killAll` on stop, as on POSIX.
#
# Runs the REAL registry (qa/tests/lib/restored-pid-identity-probe.ts).
# See change: guard-restored-headless-identity, add-windows-process-identity.

$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }
Set-Location $repo

Write-Host "=== Test: restored headless pid identity (Windows) ==="
# A cold Windows PowerShell start takes ~2.8 s (spike), longer than the registry's
# 2 s probe bound: warm it first so the probes below measure the warm path.
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "1" | Out-Null

function Probe($case) {
  $env:QA_CASE = $case
  $out = (npx --yes tsx qa/tests/lib/restored-pid-identity-probe.ts) | Where-Object { $_ -like "{*" } | Select-Object -Last 1
  Write-Host $out
  if (-not $out) { Write-Host "FAIL: probe printed no verdict for '$case'"; exit 1 }
  return ($out | ConvertFrom-Json)
}

$j = Probe "recycled"
if (-not $j.aliveAfterCleanup) { Write-Host "FAIL X11: recycled decoy was signalled at startup"; exit 1 }
if (-not $j.aliveAfterKillAll) { Write-Host "FAIL X11: recycled decoy was signalled by an unattended killAll"; exit 1 }
if ($j.afterCleanup.filePids.Count -ne 0) { Write-Host "FAIL X11: recycled 8-day entry still in the pid file"; exit 1 }
if (-not (($j.logs -join "`n") -match "identity mismatch pid=.* kind=spawn")) { Write-Host "FAIL X11: no identity mismatch log"; exit 1 }
Write-Host "X11: recycled pid refused, logged, never signalled"

$j = Probe "genuine"
if ($j.afterCleanup.size -ne 1) { Write-Host "FAIL: genuine orphan not reclaimed"; exit 1 }
if (-not $j.aliveAfterCleanup) { Write-Host "FAIL: genuine orphan killed at startup (not 7 days old)"; exit 1 }
if ($j.aliveAfterKillAll) { Write-Host "FAIL: genuine orphan survived killAll on stop"; exit 1 }
Write-Host "genuine orphan reclaimed, then killed on stop"
Write-Host "PASS"
