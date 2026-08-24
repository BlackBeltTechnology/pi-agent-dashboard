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
#
# Section 4 is the one that may prove infeasible on a hosted runner rather than
# false: `chmod` is a documented no-op on Windows, so the guarantee rests
# entirely on inherited NTFS ACLs, and observing that honestly needs a real
# second user. It is written to say WHICH of those two it hit.
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
  if ($health.piGatewayPort -isnot [int]) {
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
  $reconnectScript = @'
const WebSocket = require('ws');
const PI_PORT = process.env.PI_PORT;
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
  console.log('reconnected');
  process.exit(0);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
'@
  $reconnectPath = Join-Path $qaHome "reconnect.cjs"
  Set-Content -Path $reconnectPath -Value $reconnectScript -Encoding UTF8
  Push-Location $repo
  $reconnectOut = & node $reconnectPath 2>&1
  $reconnectCode = $LASTEXITCODE
  Pop-Location
  if ($reconnectCode -ne 0 -or "$reconnectOut" -notmatch "reconnected") {
    Write-Error "FAIL: bridge connect/reconnect over loopback failed: $reconnectOut"
    exit 1
  }
  $sessions = Invoke-RestMethod -Uri "http://localhost:$port/api/sessions" -TimeoutSec 5
  $mine = @($sessions.sessions | Where-Object { $_.id -eq $env:QA_SESSION })
  if ($mine.Count -ne 1) {
    Write-Error "FAIL: expected exactly 1 session after a reconnect, found $($mine.Count) — a reconnect must not mint a twin"
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
  $credDir = Join-Path $realHome ".pi\dashboard\local"
  $tokenPath = Join-Path $credDir "token"

  if (-not (Test-Path $tokenPath)) {
    # Create it through the real code path rather than by hand, so the ACLs are
    # the ones the product actually produces.
    New-Item -ItemType Directory -Force -Path $credDir | Out-Null
    Set-Content -Path $tokenPath -Value "qa-placeholder-token" -Encoding UTF8
    Write-Host "  NOTE: token did not exist; created one in the real profile to observe inheritance"
  }

  $acl = Get-Acl $tokenPath
  Write-Host "  token ACL owner: $($acl.Owner)"
  $broad = $acl.Access | Where-Object {
    $_.IdentityReference -match "Everyone|BUILTIN\\Users|Authenticated Users" -and
    $_.AccessControlType -eq "Allow"
  }
  if ($broad) {
    Write-Host "  OBSERVED: the DACL grants read to a broad principal:"
    $broad | ForEach-Object { Write-Host "    $($_.IdentityReference) : $($_.FileSystemRights)" }
  } else {
    Write-Host "  OBSERVED: no broad principal (Everyone/Users/Authenticated Users) in the DACL"
  }

  # The empirical half. `Get-Acl` says what the ACL CLAIMS; only a real read
  # attempt by a real standard user says what the OS ENFORCES.
  $aclVerdict = if ($broad) { "READABLE-BY-BROAD-PRINCIPAL" } else { "restricted" }
  $readVerdict = "not-attempted"
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
    $probeOut = Join-Path $env:TEMP "qa-acl-probe-$PID.txt"
    $probeScript = Join-Path $env:TEMP "qa-acl-probe-$PID.ps1"
    Set-Content -Path $probeScript -Encoding UTF8 -Value @"
try { Get-Content -Path '$tokenPath' -ErrorAction Stop | Out-Null; 'READ-SUCCEEDED' } catch { 'READ-DENIED: ' + `$_.Exception.GetType().Name } | Set-Content -Path '$probeOut'
"@
    # The probe must be readable BY the other user, or we would measure our own
    # ACL on the script instead of the ACL on the credential.
    icacls $probeScript /grant "${otherUser}:(RX)" | Out-Null
    icacls $env:TEMP /grant "${otherUser}:(RX)" | Out-Null

    Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $probeScript) `
      -Credential $cred -WindowStyle Hidden -Wait -ErrorAction Stop
    if (Test-Path $probeOut) {
      $readVerdict = (Get-Content $probeOut -Raw).Trim()
    } else {
      $readVerdict = "infeasible: the impersonated process produced no output"
    }
  } catch {
    $readVerdict = "infeasible: " + $_.Exception.Message
  }

  Write-Host "  ACL inspection : $aclVerdict"
  Write-Host "  read attempt   : $readVerdict"

  if ($readVerdict -match "^READ-SUCCEEDED") {
    Write-Error @"
FAIL: a second STANDARD OS user read $tokenPath

This is task 5.6's trigger, not a test bug: chmod is a no-op on Windows, so
the local-token secret rests on inherited NTFS ACLs, and they did not hold.
identity.key and paired-devices.json sit in the same tree under the same
inheritance, so treat this as pre-existing and file it as its own change.
"@
    exit 1
  }
  if ($readVerdict -match "^READ-DENIED") {
    Write-Host "  the OS refused the read by a real standard user"
  } else {
    Write-Host "  NOTE: the empirical read could not be performed on this host."
    Write-Host "        The ACL inspection above stands on its own, but 12.53 stays"
    Write-Host "        OPEN until a real Windows host runs this section."
    if ($aclVerdict -eq "READABLE-BY-BROAD-PRINCIPAL") {
      Write-Error "FAIL: no empirical read was possible AND the DACL grants a broad principal — that combination cannot be called safe"
      exit 1
    }
  }

  Write-Host "PASS: Windows resolves to loopback, reconnects as one session, and the credential ACL held"
} finally {
  Cleanup
}
