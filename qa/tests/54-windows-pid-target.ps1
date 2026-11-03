# Test: on a Windows server a WSL pid is never taskkilled, while a legacy
# native Windows pi stays stoppable by an operator (Q8).
#
# test-plan #X82: a session reporting a WSL namespace whose pid equals a live
#   Windows process C4 -> force_kill refused, shutdown reports session_orphaned,
#   C4 alive.
# test-plan #X83: legacy WSL (no namespace, cwd /home/u/p) -> refused, C5 alive.
# test-plan #X84: legacy native pi (no namespace, cwd C:\work) -> force_kill
#   kills C6 within 5 s (operator keeps today's signal).
# test-plan #X85: the same legacy native pi under an UNATTENDED reclaim ->
#   refused-identity, C7 alive.
#
# Runs the REAL handlers / terminator and REAL Windows primitives
# (qa/tests/lib/pid-target-probe.ts), in the style of 45-windows-reclaim-refused.ps1.
# See change: scope-pids-to-namespace.

$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }
Set-Location $repo

Write-Host "=== Test: pid target on Windows (WSL pids never taskkilled) ==="

$children = @()
function Start-StandIn {
  $p = Start-Process -FilePath "node" -ArgumentList @("-e", "setTimeout(()=>{}, 600000)") -PassThru -WindowStyle Hidden
  $script:children += $p
  return $p
}
function Cleanup {
  foreach ($c in $script:children) {
    if ($c -and -not $c.HasExited) { Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue }
  }
}
function Is-Alive([int]$procId) { return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue) }

trap { Cleanup; break }

try {
  $c4 = Start-StandIn; $c5 = Start-StandIn; $c6 = Start-StandIn; $c7 = Start-StandIn
  Start-Sleep -Milliseconds 700
  foreach ($c in @($c4, $c5, $c6, $c7)) { if ($c.HasExited) { Write-Error "FAIL: a stand-in process exited early"; exit 1 } }

  $wsl = @{ platform = "linux"; kind = "wsl"; distro = "Ubuntu-24.04"; hostId = "boot-W"; nsId = "pid:[4026531840]" }
  $cases = @(
    @{ name = "wsl"; pid = $c4.Id; action = "force_kill"; cwd = "/home/u/p"; pidNamespace = $wsl },
    @{ name = "wsl"; pid = $c4.Id; action = "shutdown"; cwd = "/home/u/p"; pidNamespace = $wsl },
    @{ name = "legacy-wsl"; pid = $c5.Id; action = "force_kill"; cwd = "/home/u/p" },
    @{ name = "native"; pid = $c6.Id; action = "force_kill"; cwd = "C:\work" },
    @{ name = "native-unattended"; pid = $c7.Id; action = "terminate-unattended"; cwd = "C:\work" }
  )
  $env:QA_CASES = ConvertTo-Json -InputObject $cases -Depth 5 -Compress
  $out = & npx --yes tsx qa/tests/lib/pid-target-probe.ts 2>&1 | Out-String
  Write-Host $out
  $rows = $out -split "`n" | Where-Object { $_ -match '^\{"name"' } | ForEach-Object { $_ | ConvertFrom-Json }
  function Row($name, $action) { $rows | Where-Object { $_.name -eq $name -and $_.action -eq $action } | Select-Object -First 1 }

  $r = Row "wsl" "force_kill"
  if (-not $r -or $r.success -ne $false) { Write-Error "FAIL X82: WSL force_kill was not refused"; exit 1 }
  $r = Row "wsl" "shutdown"
  if (-not $r -or $r.orphanedPid -ne $c4.Id) { Write-Error "FAIL X82: WSL shutdown did not report session_orphaned pid $($c4.Id)"; exit 1 }
  if (-not (Is-Alive $c4.Id)) { Write-Error "FAIL X82: the Windows process sharing the WSL pid was killed"; exit 1 }

  $r = Row "legacy-wsl" "force_kill"
  if (-not $r -or $r.success -ne $false) { Write-Error "FAIL X83: legacy WSL force_kill was not refused"; exit 1 }
  if (-not (Is-Alive $c5.Id)) { Write-Error "FAIL X83: legacy WSL pid was taskkilled"; exit 1 }

  $r = Row "native" "force_kill"
  if (-not $r -or $r.success -ne $true) { Write-Error "FAIL X84: legacy native force_kill did not succeed"; exit 1 }
  $deadline = (Get-Date).AddSeconds(5)
  while ((Is-Alive $c6.Id) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (Is-Alive $c6.Id) { Write-Error "FAIL X84: legacy native pi survived force_kill"; exit 1 }

  $r = Row "native-unattended" "terminate-unattended"
  if (-not $r -or $r.outcome -ne "refused-identity") { Write-Error "FAIL X85: expected refused-identity, got '$($r.outcome)'"; exit 1 }
  if (-not (Is-Alive $c7.Id)) { Write-Error "FAIL X85: an unattended reclaim signalled a legacy native pid"; exit 1 }

  Write-Host "PASS: WSL pids refused; legacy native pi stoppable by an operator; unattended reclaim refused"
} finally {
  Cleanup
}
