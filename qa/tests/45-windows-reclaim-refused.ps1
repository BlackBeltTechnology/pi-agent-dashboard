# Test: an unattended reclaim of a non-headless session is REFUSED on Windows
# (test-plan #X21, design R5).
#
# On win32 `processStartedAt` is null, so the shared terminator's identity guard
# cannot verify that a stored `session.pid` is still the registered `pi` — the
# conservative answer is to refuse, never to guess. A guess here would kill an
# unrelated process whose pid was recycled. That is a platform fact, not a POSIX
# one: it cannot be asserted from a Linux/macOS box, so this script runs the REAL
# terminator against REAL Windows primitives (`signalZero`, `processStartedAt`,
# `killProcess`) with a real `node` child standing in for the session's pi.
#
# Asserts:
#   - the outcome is `refused-identity` (not `confirmed-dead`, not `unconfirmed`)
#   - the diagnostic names `identity unverifiable on win32`
#   - the process is STILL RESIDENT afterwards (zero signals were sent)
#   - the operator path (`verifyIdentity:false`, i.e. shutdown) still kills it
#
# See change: fix-session-reclaim-tmux (test-plan #X21).

$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }

Write-Host "=== Test: unattended reclaim refused on Windows (identity unverifiable) ==="

$probe = Join-Path $repo "qa-reclaim-refused-probe.ts"
$child = $null

function Cleanup {
  if ($script:child -and -not $script:child.HasExited) {
    Stop-Process -Id $script:child.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $script:probe) { Remove-Item $script:probe -Force -ErrorAction SilentlyContinue }
}

trap { Cleanup; break }

try {
  # The stand-in for a tmux/wt-hosted pi: a long-lived node process.
  $child = Start-Process -FilePath "node" -ArgumentList @("-e", "setTimeout(()=>{}, 600000)") -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  if ($child.HasExited) { Write-Error "FAIL: the stand-in process exited early"; exit 1 }

  @"
import { createSessionTerminator } from "./packages/server/src/spawn-process/session-terminator.ts";
import { signalZero } from "./packages/shared/src/platform/process.ts";

const pid = Number(process.env.QA_CHILD_PID);
const record: any = { id: "s1", status: "idle", pid, pidRecordedAt: Date.now() };
const warnings: string[] = [];
const { terminate } = createSessionTerminator({
  sessionManager: { get: () => record, update: (_id: string, u: any) => Object.assign(record, u) },
  headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
  warn: (m: string) => warnings.push(m),
});

const unattended = await terminate("s1", { graceMs: 0, verifyIdentity: true, stampManualClose: true });
const aliveAfterRefusal = signalZero(pid) !== "esrch";
console.log(JSON.stringify({ phase: "unattended", outcome: unattended.outcome, aliveAfterRefusal, warnings }));

const operator = await terminate("s1", { graceMs: 0, verifyIdentity: false });
console.log(JSON.stringify({ phase: "operator", outcome: operator.outcome, alive: signalZero(pid) !== "esrch" }));
"@ | Set-Content -Path $probe -Encoding UTF8

  $env:QA_CHILD_PID = "$($child.Id)"
  $out = & npx tsx $probe 2>&1 | Out-String
  Write-Host $out
  $lines = $out -split "`n" | Where-Object { $_ -match '^\{"phase"' } | ForEach-Object { $_ | ConvertFrom-Json }
  $unattended = $lines | Where-Object { $_.phase -eq "unattended" } | Select-Object -First 1
  $operator = $lines | Where-Object { $_.phase -eq "operator" } | Select-Object -First 1
  if (-not $unattended -or -not $operator) { Write-Error "FAIL: the probe produced no verdict"; exit 1 }

  if ($unattended.outcome -ne "refused-identity") {
    Write-Error "FAIL: expected refused-identity for an unattended reclaim on win32, got '$($unattended.outcome)'"
    exit 1
  }
  if (-not $unattended.aliveAfterRefusal) {
    Write-Error "FAIL: the process was killed on an unverifiable identity - the guard must send zero signals"
    exit 1
  }
  if (-not (($unattended.warnings -join "`n") -match "identity unverifiable on win32")) {
    Write-Error "FAIL: the refusal diagnostic did not name 'identity unverifiable on win32'"
    exit 1
  }
  if ($operator.outcome -ne "confirmed-dead" -or $operator.alive) {
    Write-Error "FAIL: the operator path (verifyIdentity:false) must still terminate the process, got '$($operator.outcome)'"
    exit 1
  }

  Write-Host "PASS: unattended reclaim refused with a win32 identity diagnostic; operator shutdown still terminates"
} finally {
  Cleanup
}
