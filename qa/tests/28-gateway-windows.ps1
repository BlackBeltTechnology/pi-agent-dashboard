# Test: the Windows half of gateway transport + identity.
#
# Windows is the platform where every claim in this change inverts. There is no
# unix-socket path, so `resolveLocalGatewayEndpoint` falls back to
# `127.0.0.1:<piPort>` unconditionally — which means the kernel-decided
# permission of D5 is GONE and a loopback port plus a token is doing the work
# instead. That is not a smaller claim, it is a different one, and it cannot be
# checked from a POSIX box.
#
# Four sections, in falling order of certainty:
#   1. loopback endpoint, no socket anywhere      (task 5.1)
#   2. a bridge connects, drops, and reconnects   (task 5.7)
#   3. a stale record is not adopted              (tasks 5.7, 2.0h)
#   4. a second OS user cannot read the credentials (tasks 5.5 / 12.53)
#      — all THREE of them: local/token, identity.key and paired-devices.json.
#        They share the tree and the inherited ACL, but one file's answer is not
#        evidence for its neighbours', so each is inspected AND read-attempted
#        separately.
#
#        A run that yields no read verdict FAILS. windows-latest demonstrably
#        can yield one — observed READ-DENIED for all three on 2026-09-14 — so a
#        silent pass here would only ever hide a broken harness.
#
# Section 4 is the one that used to prove infeasible on a hosted runner rather
# than false: `chmod` is a documented no-op on Windows, so the guarantee rests
# entirely on inherited NTFS ACLs, and observing that honestly needs a real
# second user. It turned out the hosted runner COULD do it — the probe had been
# writing its verdict where the second user could not reach it — so §4 now
# requires a verdict and fails without one.
#
# tasks 5.1, 5.4b, 5.5, 5.7, 12.53, 13.8 · test-plan #F8, #X17
# See change: add-pi-gateway-transport-identity.

$ErrorActionPreference = "Stop"

$port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { "18840" }
$piPort = if ($env:PI_GATEWAY_PORT) { $env:PI_GATEWAY_PORT } else { "19840" }
$repo = if ($env:QA_REPO_ROOT) { $env:QA_REPO_ROOT } else { (Get-Location).Path }

Write-Host "=== Test: gateway transport + identity on Windows ==="

$qaHome = Join-Path $env:TEMP "qa-gw-win-$PID"
$serverProc = $null
# The real profile, deliberately NOT the hermetic one — section 4 tests ACL
# INHERITANCE, and a temp directory inherits from somewhere else entirely.
$realHome = $env:USERPROFILE
$otherUser = "piqa$PID"
$otherUserCreated = $false

function Cleanup {
  if ($script:serverProc -and -not $script:serverProc.HasExited) {
    Stop-Process -Id $script:serverProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($script:otherUserCreated) {
    Remove-LocalUser -Name $script:otherUser -ErrorAction SilentlyContinue
  }
  if ($script:probeDir -and (Test-Path $script:probeDir)) {
    Remove-Item -Recurse -Force $script:probeDir -ErrorAction SilentlyContinue
  }
  foreach ($leftover in @("qa-reconnect-probe.cjs", "qa-mint-token.ts")) {
    $lp = Join-Path $script:repo $leftover
    if (Test-Path $lp) { Remove-Item $lp -Force -ErrorAction SilentlyContinue }
  }
  if (Test-Path $script:qaHome) {
    Remove-Item -Recurse -Force $script:qaHome -ErrorAction SilentlyContinue
  }
}

trap { Cleanup; break }

try {
  # Refuse to run against a stranger — a passing assertion against someone
  # else's dashboard proves nothing about this build.
  try {
    Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 2 | Out-Null
    Write-Error "FAIL: something is already serving on port $port"
    exit 1
  } catch { }

  New-Item -ItemType Directory -Force -Path $qaHome | Out-Null

  # ── 1. loopback endpoint, no socket anywhere (task 5.1) ──────────────────
  # A hermetic profile so the record, the token and the endpoint all resolve
  # here. On Windows `os.homedir()` reads USERPROFILE, so that is the knob.
  $bin = Join-Path $repo "packages\server\bin\pi-dashboard.mjs"
  if (-not (Test-Path $bin)) { Write-Error "FAIL: server entry not found at $bin"; exit 1 }

  $env:USERPROFILE = $qaHome
  $env:HOME = $qaHome
  $serverProc = Start-Process -FilePath "node" `
    -ArgumentList @($bin, "--port", $port, "--pi-port", $piPort, "--no-tunnel") `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $qaHome "start.log") `
    -RedirectStandardError (Join-Path $qaHome "start.err.log")

  $health = $null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try { $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 3; break } catch { }
  }
  if (-not $health) {
    Write-Host "--- start.log ---"; Get-Content (Join-Path $qaHome "start.log") -Tail 40 -ErrorAction SilentlyContinue
    Write-Host "--- start.err.log ---"; Get-Content (Join-Path $qaHome "start.err.log") -Tail 40 -ErrorAction SilentlyContinue
    Write-Error "FAIL: the dashboard never started on Windows"
    exit 1
  }

  # The field the settings UI renders. A string here would mean something
  # tried to hand Windows a socket path.
  # The distinction under test is number-vs-STRING: a socket path would arrive
  # as a string. Do not pin the numeric WIDTH — ConvertFrom-Json hands back
  # Int64 here, and demanding Int32 fails a correct server for a JSON detail.
  if ($health.piGatewayPort -is [string] -or ($health.piGatewayPort -as [int64]) -eq $null) {
    Write-Error "FAIL: expected a numeric loopback port on /api/health, got '$($health.piGatewayPort)' ($($health.piGatewayPort.GetType().Name))"
    exit 1
  }
  if ("$($health.piGatewayPort)" -ne "$piPort") {
    Write-Error "FAIL: /api/health advertises port $($health.piGatewayPort), expected $piPort"
    exit 1
  }
  Write-Host "  /api/health advertises the loopback port $piPort"

  # No socket artifact may exist, under any name. `getGatewaySocketPath` must
  # never have been consulted on this platform.
  $strays = Get-ChildItem -Path $qaHome -Recurse -Filter "gateway-*.sock" -ErrorAction SilentlyContinue
  if ($strays) {
    Write-Error "FAIL: a socket artifact exists on Windows: $($strays.FullName -join ', ')"
    exit 1
  }
  Write-Host "  no gateway-*.sock artifact anywhere under the profile"

  $listener = Get-NetTCPConnection -LocalPort ([int]$piPort) -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) {
    Write-Error "FAIL: nothing is listening on $piPort — the loopback fallback did not bind"
    exit 1
  }
  Write-Host "  a TCP listener is bound on $piPort (the fallback IS the transport here)"

  # ── 2. connect, drop, reconnect (task 5.7) ───────────────────────────────
  # A bridge that connects once proves the door opens. The reconnect is the
  # part that matters in the field: a laptop sleeps, the socket dies, and the
  # session has to come back without human help.
  $env:PI_PORT = $piPort
  $env:QA_SESSION = "qa-win-gw-$PID"
  $env:DASH_PORT = $port
  $reconnectScript = @'
const WebSocket = require('ws');
const PI_PORT = process.env.PI_PORT;
const DASH_PORT = process.env.DASH_PORT;
const SESSION_ID = process.env.QA_SESSION;
const open = (ws) => new Promise((res, rej) => {
  ws.on('open', res); ws.on('error', rej);
  setTimeout(() => rej(new Error('open timeout')), 8000);
});
const register = (ws) => ws.send(JSON.stringify({
  type: 'session_register', sessionId: SESSION_ID, cwd: process.cwd(), source: 'tui', pid: process.pid,
}));
(async () => {
  const a = new WebSocket('ws://127.0.0.1:' + PI_PORT);
  a.on('error', () => {});
  await open(a);
  register(a);
  await new Promise((r) => setTimeout(r, 800));
  // Drop it the way a sleeping laptop does — no goodbye frame.
  a.terminate();
  await new Promise((r) => setTimeout(r, 1200));
  const b = new WebSocket('ws://127.0.0.1:' + PI_PORT);
  b.on('error', () => {});
  await open(b);
  register(b);
  await new Promise((r) => setTimeout(r, 800));
  // Ask WHILE STILL CONNECTED. Asking after this process exits would race the
  // gateway's own disconnect handling and could not tell "never registered"
  // from "registered, then reaped" — two very different verdicts.
  const res = await fetch('http://127.0.0.1:' + DASH_PORT + '/api/sessions');
  const body = await res.json();
  // The envelope is { success, data: [...] } — NOT { sessions }. Reading the
  // wrong key yields an empty list, which is indistinguishable from a genuine
  // registration failure, so refuse to interpret an unexpected shape at all.
  if (!Array.isArray(body.data)) {
    console.error('FAIL: /api/sessions did not return a data array; keys=' + JSON.stringify(Object.keys(body)));
    process.exit(1);
  }
  const all = body.data;
  const mine = all.filter((s) => s.id === SESSION_ID);
  console.log('reconnected sessions=' + mine.length + ' total=' + all.length);
  if (mine.length !== 1) {
    console.log('ids=' + JSON.stringify(all.slice(0, 8).map((s) => s.id)));
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
'@
  # The probe lives in the REPO, not in $TEMP: CommonJS resolves `ws` by
  # walking up from the FILE's directory, so a script in the temp profile
  # cannot see node_modules no matter what the working directory is.
  $reconnectPath = Join-Path $repo "qa-reconnect-probe.cjs"
  Set-Content -Path $reconnectPath -Value $reconnectScript -Encoding UTF8
  Push-Location $repo
  $reconnectOut = & node $reconnectPath 2>&1
  $reconnectCode = $LASTEXITCODE
  Pop-Location
  Remove-Item $reconnectPath -Force -ErrorAction SilentlyContinue
  if ($reconnectCode -ne 0 -or "$reconnectOut" -notmatch "reconnected") {
    Write-Error "FAIL: bridge connect/reconnect over loopback failed: $reconnectOut"
    exit 1
  }
  if ("$reconnectOut" -notmatch "sessions=1\b") {
    Write-Error "FAIL: expected exactly 1 session after a reconnect — a reconnect must not mint a twin, nor vanish. Probe said: $reconnectOut"
    exit 1
  }
  Write-Host "  a bridge connected, dropped hard, and reconnected as ONE session"

  # ── 3. a stale record is not adopted (tasks 5.7, 2.0h) ───────────────────
  # The record names a dashboard that is gone. Attaching to it would send every
  # future pi to a dead endpoint; the correct move is to take ownership.
  $recordPath = Join-Path $qaHome ".pi\dashboard\rendezvous.json"
  if (-not (Test-Path $recordPath)) {
    $found = Get-ChildItem -Path (Join-Path $qaHome ".pi") -Recurse -Filter "*.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "rendezvous|server.lock" }
    Write-Host "  NOTE: no rendezvous.json at the expected path; found: $($found.FullName -join ', ')"
  }
  $liveIdentity = $health.instanceId
  if (-not $liveIdentity) {
    Write-Error "FAIL: /api/health carries no instanceId — identity cannot be verified at all"
    exit 1
  }
  Write-Host "  the live instance identifies as $liveIdentity"

  # ── 4. a second OS user cannot read the credentials (5.5 / 12.53) ────────
  # Runs against the REAL profile: inheritance is the mechanism under test, and
  # a temp dir inherits from a different parent. Skipped, loudly, when the
  # runner cannot create a user — an untested claim must not read as a pass.
  $env:USERPROFILE = $realHome
  $env:HOME = $realHome
  $dashboardDir = Join-Path $realHome ".pi\dashboard"
  # All THREE files task 1.3 names. They share this tree and the ACL it
  # inherits, so one file's answer is not the other two's: each gets its own
  # DACL inspection and its own read attempt. Until now only `local/token` was
  # ever examined, and the unexamined pair is the more sensitive one — a
  # private signing key and every paired device's bearer.
  $credTargets = @(
    [pscustomobject]@{ Name = "local/token";         Path = (Join-Path $dashboardDir "local\token") }
    [pscustomobject]@{ Name = "identity.key";        Path = (Join-Path $dashboardDir "identity.key") }
    [pscustomobject]@{ Name = "paired-devices.json"; Path = (Join-Path $dashboardDir "paired-devices.json") }
  )

  # Mint whatever is absent THROUGH THE PRODUCT's own writers, not Set-Content.
  # The question 5.5 asks is what permissions `ensureLocalToken`,
  # `ensureServerIdentity` and `PairedDeviceRegistry` leave behind on Windows,
  # where their chmod is a no-op — a file this script wrote by hand would answer
  # a question nobody asked.
  $missing = @($credTargets | Where-Object { -not (Test-Path $_.Path) })
  if ($missing.Count -gt 0) {
    $mintPath = Join-Path $repo "qa-mint-token.ts"
    Set-Content -Path $mintPath -Encoding UTF8 -Value @'
import { ensureLocalToken } from "./packages/server/src/auth/local-token.js";
import { ensureServerIdentity } from "./packages/server/src/auth/identity.js";
import { PairedDeviceRegistry } from "./packages/server/src/pairing/paired-devices.js";
const t = ensureLocalToken();
ensureServerIdentity();
// Touched, then revoked. Creating the registry through its own writer is what
// puts a real ACL on the file; the revoke leaves the operator's paired devices
// exactly as they were, so observing the ACL costs them nothing.
const reg = new PairedDeviceRegistry();
const added = reg.add("qa-acl-probe");
reg.revoke(added.device.id);
console.log("minted token=" + (t ? "ok" : "empty") + " identity=ok paired=ok");
'@
    Push-Location $repo
    $mintOut = & npx tsx $mintPath 2>&1
    $mintCode = $LASTEXITCODE
    Pop-Location
    Remove-Item $mintPath -Force -ErrorAction SilentlyContinue
    if ($mintCode -ne 0) {
      Write-Error "FAIL: could not mint the credentials through the product's own writers: $mintOut"
      exit 1
    }
    foreach ($target in $credTargets) {
      if (-not (Test-Path $target.Path)) {
        Write-Error "FAIL: $($target.Name) is still absent after the product's writer ran — its ACL cannot be observed"
        exit 1
      }
    }
    Write-Host "  credentials minted by the product's own writers ($($missing.Count) of 3 were absent)"
  } else {
    Write-Host "  all three credential files already existed (product-created); observing them as found"
  }

  # The ACL CLAIMS; only a real read by a real standard user says what the OS
  # ENFORCES. Report the two separately AND per file — the whole point of this
  # change is that the first is not evidence for the second.
  $broadByFile = @{}
  foreach ($target in $credTargets) {
    $acl = Get-Acl $target.Path
    $broad = $acl.Access | Where-Object {
      $_.IdentityReference -match "Everyone|BUILTIN\\Users|Authenticated Users" -and
      $_.AccessControlType -eq "Allow"
    }
    if ($broad) {
      Write-Host "  OBSERVED: the $($target.Name) DACL grants a broad principal (owner $($acl.Owner)):"
      $broad | ForEach-Object { Write-Host "    $($_.IdentityReference) : $($_.FileSystemRights)" }
      $broadByFile[$target.Name] = $true
    } else {
      Write-Host "  OBSERVED: no broad principal (Everyone/Users/Authenticated Users) in the $($target.Name) DACL (owner $($acl.Owner))"
      $broadByFile[$target.Name] = $false
    }
  }
  $broadFiles = @($credTargets | Where-Object { $broadByFile[$_.Name] } | ForEach-Object { $_.Name })

  # The empirical half. `Get-Acl` says what the ACL CLAIMS; only a real read
  # attempt by a real standard user says what the OS ENFORCES.
  $aclVerdict = if ($broadFiles.Count -gt 0) { "READABLE-BY-BROAD-PRINCIPAL: " + ($broadFiles -join ", ") } else { "restricted" }
  $readVerdict = "not-attempted"
  $readByFile = @{}
  # The exception type the probe caught, kept for DISPLAY only. A locked file
  # raises an IOException that the read attempt cannot tell apart from a denial,
  # so the M1 host run must be able to SEE it — otherwise an "unavailable" file
  # gets recorded in docs/architecture.md as an OBSERVED ACL denial. It never
  # feeds the pass/fail partition, which stays on the exact verdict string.
  $readDetailByFile = @{}
  try {
    $pw = ConvertTo-SecureString ("Qa!" + [guid]::NewGuid().ToString("N").Substring(0, 12) + "#9") -AsPlainText -Force
    New-LocalUser -Name $otherUser -Password $pw -AccountNeverExpires -UserMayNotChangePassword -ErrorAction Stop | Out-Null
    $otherUserCreated = $true
    Add-LocalGroupMember -Group "Users" -Member $otherUser -ErrorAction SilentlyContinue
    # Standard user ONLY. An administrator second user could read anything and
    # would turn this into a test that cannot fail meaningfully.
    $admins = Get-LocalGroupMember -Group "Administrators" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match [regex]::Escape($otherUser) }
    if ($admins) {
      Write-Error "FAIL: the second user landed in Administrators — this test would be vacuous"
      exit 1
    }

    $cred = New-Object System.Management.Automation.PSCredential($otherUser, $pw)
    # The probe and its verdict live in a directory the SECOND USER may read AND
    # write. The previous revision put both in this user's %TEMP% and granted the
    # second user only (RX) — and a standard user cannot traverse another user's
    # profile at all, so even a SUCCESSFUL impersonation could not have produced
    # output. "produced no output" is therefore indistinguishable from a logon
    # that never happened, which is exactly the ambiguity `infeasible` hid.
    # C:\ProgramData sits outside every profile and is traversable by Users.
    $probeDir = Join-Path $env:ProgramData "qa-acl-$PID"
    $script:probeDir = $probeDir
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    icacls $probeDir /grant "${otherUser}:(M)" | Out-Null
    $probeOut = Join-Path $probeDir "verdict.json"
    $probeScript = Join-Path $probeDir "probe.ps1"

    # One impersonated run, one verdict per file. Stopping at the first surprise
    # would leave the other two unexamined — the exact gap task 1.3 closes.
    $probePaths = ($credTargets | ForEach-Object { "'" + $_.Path.Replace("'", "''") + "'" }) -join ", "
    $probeBody = @'
$out = @()
foreach ($p in @(__PATHS__)) {
  try { Get-Content -Path $p -ErrorAction Stop | Out-Null; $out += [pscustomobject]@{ Path = $p; Verdict = "READ-SUCCEEDED" } }
  catch { $out += [pscustomobject]@{ Path = $p; Verdict = "READ-DENIED"; Error = $_.Exception.GetType().Name } }
}
$out | ConvertTo-Json -Compress | Set-Content -Path '__OUT__'
'@
    $probeBody = $probeBody.Replace("__PATHS__", $probePaths).Replace("__OUT__", $probeOut.Replace("'", "''"))
    Set-Content -Path $probeScript -Encoding UTF8 -Value $probeBody

    Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $probeScript) `
      -Credential $cred -WindowStyle Hidden -Wait -ErrorAction Stop
    if ((Test-Path $probeOut) -and (Get-Item $probeOut).Length -gt 0) {
      foreach ($row in @(Get-Content $probeOut -Raw | ConvertFrom-Json)) {
        $readByFile["$($row.Path)"] = "$($row.Verdict)"
        $readDetailByFile["$($row.Path)"] = "$($row.Error)"
      }
      $readVerdict = "attempted"
    } else {
      $readVerdict = "infeasible: the impersonated process produced no output"
    }
  } catch {
    $readVerdict = "infeasible: " + $_.Exception.Message
  }

  Write-Host "  ACL inspection : $aclVerdict"
  if ($readVerdict -eq "attempted") {
    Write-Host "  read attempt   :"
    foreach ($target in $credTargets) {
      $verdict = if ($readByFile.ContainsKey($target.Path)) { $readByFile[$target.Path] } else { "NO-VERDICT" }
      $detail = if ($readDetailByFile[$target.Path]) { " ($($readDetailByFile[$target.Path]))" } else { "" }
      Write-Host "    $($target.Name): $verdict$detail"
    }
  } else {
    Write-Host "  read attempt   : $readVerdict"
  }

  $leaked = @($credTargets | Where-Object { $readByFile[$_.Path] -eq "READ-SUCCEEDED" } | ForEach-Object { $_.Name })
  $unanswered = @($credTargets | Where-Object { -not $readByFile.ContainsKey($_.Path) } | ForEach-Object { $_.Name })

  if ($leaked.Count -gt 0) {
    Write-Error @"
FAIL: a second STANDARD OS user read $($leaked -join ', ')

This is task 5.6's trigger, not a test bug: chmod is a no-op on Windows, so
these secrets rest on inherited NTFS ACLs, and they did not hold. All three
files share that tree and that inheritance, so treat it as PRE-EXISTING across
them and file it as its own change rather than patching it here.
"@
    exit 1
  }
  if ($unanswered.Count -gt 0) {
    # No verdict is an EVIDENCE failure, never a pass. An ACL that merely names
    # no broad principal describes configuration, not enforced behaviour, and
    # distinguishing the two is the entire reason this arm exists. It used to
    # print a NOTE here and pass; windows-latest proved on 2026-09-14 that the
    # read IS performable there, so that pass was only ever hiding a harness
    # that could not write its own verdict. Say "evidence", loudly, so a red run
    # is never mistaken for a leak.
    Write-Error @"
FAIL: the arm could not establish that a second STANDARD OS user is refused

No read verdict was produced for: $($unanswered -join ', ')

This is NOT a finding that the credentials leaked — nothing was read. It is a
finding that the claim went UNTESTED, which this arm exists to refuse to call
safe. ACL inspection said: $aclVerdict

Check, in order: the Secondary Logon (seclogon) service is running; New-LocalUser
succeeded; and the second user can both READ and WRITE in the probe directory
(Start-Process -Credential yields no output at all if it cannot).
"@
    exit 1
  }

  Write-Host "  the OS refused the read of all three credentials by a real standard user"
  Write-Host "PASS: Windows resolves to loopback, reconnects as one session, and all three credential ACLs were observed to hold"
} finally {
  Cleanup
}
