# Test: on Windows a restored headless-registry pid has no start-time probe
# (`unverifiable`, until #913), so neither the startup 7-day kill nor an
# unattended stop signals it.
#
# test-plan #X11: a REAL decoy seeded as an 8-day-old entry → decoy alive after
#   startup and after an unattended `killAll`; entry kept in the pid file; a log
#   line states the identity was unverifiable. Pre-change the decoy was killed.
# test-plan #X12: wired into the windows job of ci-gateway-platform.yml.
#
# Runs the REAL registry (qa/tests/lib/restored-pid-identity-probe.ts).
# See change: guard-restored-headless-identity.

$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }
Set-Location $repo

Write-Host "=== Test: restored headless pid identity (Windows) ==="
$env:QA_CASE = "recycled"
$out = (npx --yes tsx qa/tests/lib/restored-pid-identity-probe.ts) | Where-Object { $_ -like "{*" } | Select-Object -Last 1
Write-Host $out
if (-not $out) { Write-Host "FAIL X11: probe printed no verdict"; exit 1 }
$j = $out | ConvertFrom-Json
if (-not $j.aliveAfterCleanup) { Write-Host "FAIL X11: decoy was killed at startup"; exit 1 }
if (-not $j.aliveAfterKillAll) { Write-Host "FAIL X11: decoy was killed by an unattended killAll"; exit 1 }
if ($j.afterCleanup.filePids.Count -ne 1) { Write-Host "FAIL X11: unverifiable entry was dropped from the pid file"; exit 1 }
if (-not (($j.logs -join "`n") -match "unverifiable")) { Write-Host "FAIL X11: no unverifiable log line"; exit 1 }
Write-Host "X11: unverifiable restored pid kept and never signalled"
Write-Host "PASS"
