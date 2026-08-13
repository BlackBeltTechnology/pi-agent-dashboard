# Test: a duplicate bridge refused for a held session id is terminal, and the
# gateway keeps exactly one live bridge per session id.
#
# test-plan #X10 (L2). Windows twin of 17-bridge-contention.sh.
# See change: fix-duplicate-bridge-registration.

$ErrorActionPreference = "Stop"

Write-Host "=== Test: bridge registration contention ==="

$port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { "8000" }
$piPort = if ($env:PI_GATEWAY_PORT) { $env:PI_GATEWAY_PORT } else { "9999" }

try {
  $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10
} catch {
  Write-Error "FAIL: Server not running (health request failed)"
  exit 1
}

$sessionId = "qa-contention-$PID"

$env:PI_PORT = $piPort
$env:SESSION_ID = $sessionId

$script = @'
const WebSocket = require('ws');
const PI_PORT = process.env.PI_PORT;
const SESSION_ID = process.env.SESSION_ID;

const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const open = (ws) => new Promise((res, rej) => {
  ws.on('open', res);
  ws.on('error', rej);
  setTimeout(() => rej(new Error('open timeout')), 5000);
});
const reg = (ws, extra) => ws.send(JSON.stringify(Object.assign({
  type: 'session_register', sessionId: SESSION_ID, cwd: 'C:/tmp/qa-contention', source: 'tui',
}, extra)));

(async () => {
  const a = new WebSocket('ws://localhost:' + PI_PORT);
  a.on('error', () => {});
  await open(a);
  reg(a, { pid: 111111 });
  await new Promise((r) => setTimeout(r, 500));

  const b = new WebSocket('ws://localhost:' + PI_PORT);
  b.on('error', () => {});
  const frames = [];
  b.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch {} });
  await open(b);

  const closed = new Promise((r) => b.on('close', r));
  reg(b, { pid: 222222, spawnToken: 'qa-token-' + process.pid });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('duplicate was never closed')), 15000));
  await Promise.race([closed, timeout]);

  const rejection = frames.find((f) => f.type === 'register_rejected');
  if (!rejection) fail('refused bridge received no register_rejected frame');
  if (rejection.sessionId !== SESSION_ID) fail('rejection named the wrong session id');
  if (!rejection.reason) fail('rejection carried no reason');
  if (a.readyState !== WebSocket.OPEN) fail('incumbent was closed by the contention');

  console.log('Contention: duplicate refused and closed, incumbent retained');
  a.close();
  process.exit(0);
})().catch((e) => fail(e.message));
'@

# Write the probe INSIDE the repo, not the system temp dir: node resolves the
# bare specifier `ws` by walking node_modules upward from the script's own
# directory, and the system temp dir never reaches the repository node_modules.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tmp = Join-Path $repoRoot ".qa-contention-probe-$PID.js"
Set-Content -Path $tmp -Value $script -Encoding UTF8
try {
  Push-Location $repoRoot
  & node $tmp
  $probeExit = $LASTEXITCODE
  Pop-Location
  if ($probeExit -ne 0) { Write-Error "FAIL: contention probe failed"; exit 1 }
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

$health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10
if ($null -eq $health.bridgeContentionCount) {
  Write-Error "FAIL: /api/health does not expose bridgeContentionCount"
  exit 1
}
if ($null -eq $health.contendedSessionIds) {
  Write-Error "FAIL: /api/health does not expose contendedSessionIds"
  exit 1
}

Write-Host "Health: contention counters exposed"
Write-Host "PASS: bridge contention"
