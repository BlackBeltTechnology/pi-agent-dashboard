# Test: an unattended reclaim of a non-headless session is VERIFIED and KILLED on
# Windows (test-plan #E54; supersedes the #X21 refusal of fix-session-reclaim-tmux R5).
#
# Windows used to refuse every unattended reclaim because `processStartedAt` is
# null on win32. `add-windows-process-identity` replaces the refusal: the shared
# terminator runs `verifyAndKillWindows`, ONE PowerShell call that pins the process
# handle, checks `StartTime <= pidRecordedAt + tolerance` and tree-kills. This
# script runs the REAL terminator against REAL Windows primitives with real `node`
# children standing in for the session's pi.
#
# Asserts:
#   - unattended reclaim of a pid recorded at/after its start => `confirmed-dead`,
#     and the child is GONE (it used to be `refused-identity`, child resident)
#   - the operator path (`verifyIdentity:false`, i.e. shutdown) still kills a child
#
# The filename is kept (CI/QA references); the assertion it names is now the
# verified reclaim. See change: add-windows-process-identity (test-plan #E54).

# No space in the -e program: Start-Process joins -ArgumentList unquoted, so a space would
# split it and node would exit on a syntax error.
$ErrorActionPreference = "Stop"
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }

Write-Host "=== Test: unattended reclaim is verified and kills on Windows ==="

$probe = Join-Path $repo "qa-reclaim-refused-probe.ts"
$child = $null
$child2 = $null

function Cleanup {
  foreach ($c in @($script:child, $script:child2)) {
    if ($c -and -not $c.HasExited) {
      Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path $script:probe) { Remove-Item $script:probe -Force -ErrorAction SilentlyContinue }
}

trap { Cleanup; break }

try {
  # The stand-in for a tmux/wt-hosted pi: a long-lived node process.
  $child = Start-Process -FilePath "node" -ArgumentList @("-e", "setTimeout(()=>{},600000)") -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  if ($child.HasExited) { Write-Error "FAIL: the stand-in process exited early"; exit 1 }
  $child2 = Start-Process -FilePath "node" -ArgumentList @("-e", "setTimeout(()=>{},600000)") -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  if ($child2.HasExited) { Write-Error "FAIL: the second stand-in process exited early"; exit 1 }

  @"
import { createSessionTerminator } from "./packages/server/src/spawn-process/session-terminator.ts";
import { signalZero } from "./packages/shared/src/platform/process.ts";
import { getServerPidContext } from "./packages/server/src/session/server-pid-context.ts";

const pid = Number(process.env.QA_CHILD_PID);
const pid2 = Number(process.env.QA_CHILD2_PID);
// A bridge on this host reports its pid namespace; without it the target is `unknown` and an
// unattended reclaim is refused before any helper runs.
const ctx = getServerPidContext();
const record: any = { id: "s1", status: "idle", pid, pidRecordedAt: Date.now(), pidNamespace: { platform: ctx.platform, kind: "host", hostId: ctx.hostId } };
const warnings: string[] = [];
const { terminate } = createSessionTerminator({
  sessionManager: { get: () => record, update: (_id: string, u: any) => Object.assign(record, u) },
  headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
  warn: (m: string) => warnings.push(m),
});

const unattended = await terminate("s1", { graceMs: 0, verifyIdentity: true, stampManualClose: true });
console.log(JSON.stringify({ phase: "unattended", outcome: unattended.outcome, goneAfter: signalZero(pid) === "esrch", warnings }));

record.pid = pid2;
record.pidRecordedAt = Date.now();
const operator = await terminate("s1", { graceMs: 0, verifyIdentity: false });
console.log(JSON.stringify({ phase: "operator", outcome: operator.outcome, goneAfter: signalZero(pid2) === "esrch" }));
"@ | Set-Content -Path $probe -Encoding UTF8

  $env:QA_CHILD_PID = "$($child.Id)"
  $env:QA_CHILD2_PID = "$($child2.Id)"
  $out = & npx tsx $probe 2>&1 | Out-String
  Write-Host $out
  $lines = $out -split "`n" | Where-Object { $_ -match '^\{"phase"' } | ForEach-Object { $_ | ConvertFrom-Json }
  $unattended = $lines | Where-Object { $_.phase -eq "unattended" } | Select-Object -First 1
  $operator = $lines | Where-Object { $_.phase -eq "operator" } | Select-Object -First 1
  if (-not $unattended -or -not $operator) { Write-Error "FAIL: the probe produced no verdict"; exit 1 }

  if ($unattended.outcome -ne "confirmed-dead") {
    Write-Error "FAIL: expected confirmed-dead for a verified unattended reclaim on win32, got '$($unattended.outcome)'"
    exit 1
  }
  if (-not $unattended.goneAfter) {
    Write-Error "FAIL: the process is still resident after a confirmed-dead reclaim"
    exit 1
  }
  if (($unattended.warnings -join "`n") -match "identity unverifiable") {
    Write-Error "FAIL: win32 identity must be verifiable now, but the terminator still logged 'identity unverifiable'"
    exit 1
  }
  if ($operator.outcome -ne "confirmed-dead" -or -not $operator.goneAfter) {
    Write-Error "FAIL: the operator path (verifyIdentity:false) must still terminate the process, got '$($operator.outcome)'"
    exit 1
  }

  Write-Host "PASS: unattended reclaim verified and terminated on win32; operator shutdown still terminates"
} finally {
  Cleanup
}
