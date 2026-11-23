# Test: Windows / WSL process identity helpers against REAL processes
# (add-windows-process-identity; test-plan E19 E20 E49-E53 P1 P6, and with a
# WSL distro E55-E59 P5).
#
# Runs the REAL platform helpers + the REAL session terminator through
# qa/tests/lib/windows-process-identity-probe.ts, which prints one
# {"case","ok","detail"} JSON line per case. Any not-ok line fails the test.
#
# Env: QA_REPO_ROOT (default cwd), QA_WSL_DISTRO (default unset: skip WSL cases).
# Driven by .github/workflows/ci-windows-process-identity.yml.
# See change: add-windows-process-identity.

$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }
Set-Location $repo

Write-Host "=== Test: Windows / WSL process identity (real processes) ==="
# A cold Windows PowerShell start takes ~2.8 s (spike); warm it so the cases below
# measure the steady state (P1 still logs the first probe).
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "1" | Out-Null

# Stream the driver output live (a hung case must be visible in the job log).
$lines = New-Object System.Collections.Generic.List[string]
& npx --yes tsx qa/tests/lib/windows-process-identity-probe.ts 2>&1 | ForEach-Object { $s = "$_"; Write-Host $s; $lines.Add($s) }
$out = $lines -join "`n"
$rows = $out -split "`n" | Where-Object { $_ -match '^\{"case"' } | ForEach-Object { $_ | ConvertFrom-Json }
if (-not $rows) { Write-Host "FAIL: the probe printed no case rows"; exit 1 }
$bad = @($rows | Where-Object { -not $_.ok })
if ($bad.Count -gt 0) {
  foreach ($b in $bad) { Write-Host "FAIL $($b.case): $($b.detail)" }
  exit 1
}
Write-Host "PASS: $($rows.Count) case(s) ok"
