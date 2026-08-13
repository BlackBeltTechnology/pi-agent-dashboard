#!/usr/bin/env bash
# Test: a duplicate bridge refused for a held session id is terminal, and the
# gateway keeps exactly one live bridge per session id.
#
# test-plan #X10 (L2): a server-spawned duplicate refused for `S` is reclaimed
# by its server-minted spawn token, leaving a single writer on the incumbent's
# `.jsonl`.
#
# See change: fix-duplicate-bridge-registration.
set -euo pipefail

echo "=== Test: bridge registration contention ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# `node -e` resolves the bare `ws` specifier from the CWD, so run from the repo
# root regardless of where this script was invoked.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PORT="${DASHBOARD_PORT:-8000}"
PI_PORT="${PI_GATEWAY_PORT:-9999}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Server not running (health returned $HTTP_CODE)"
  exit 1
fi

SESSION_ID="qa-contention-$$"

PI_PORT="$PI_PORT" SESSION_ID="$SESSION_ID" node -e "
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
  type: 'session_register', sessionId: SESSION_ID, cwd: '/tmp/qa-contention', source: 'tui',
}, extra)));

(async () => {
  // Incumbent: registers the id and answers pings (ws auto-pongs).
  const a = new WebSocket('ws://localhost:' + PI_PORT);
  a.on('error', () => {});
  await open(a);
  reg(a, { pid: 111111 });
  await new Promise((r) => setTimeout(r, 500));

  // Duplicate: claims the same id, carrying a spawn token as a server spawn would.
  const b = new WebSocket('ws://localhost:' + PI_PORT);
  b.on('error', () => {});
  const frames = [];
  b.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch {} });
  await open(b);

  const closed = new Promise((r) => b.on('close', r));
  reg(b, { pid: 222222, spawnToken: 'qa-token-' + process.pid });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('duplicate was never closed')), 15000));
  await Promise.race([closed, timeout]);

  // The loser is told why, terminally, before the close.
  const rejection = frames.find((f) => f.type === 'register_rejected');
  if (!rejection) fail('refused bridge received no register_rejected frame');
  if (rejection.sessionId !== SESSION_ID) fail('rejection named the wrong session id');
  if (!rejection.reason) fail('rejection carried no reason');

  // The incumbent kept the connection.
  if (a.readyState !== WebSocket.OPEN) fail('incumbent was closed by the contention');

  console.log('Contention: duplicate refused and closed, incumbent retained');
  a.close();
  process.exit(0);
})().catch((e) => fail(e.message));
" || exit 1

# The refusal is visible on the operator surface.
HEALTH=$(curl -s "http://localhost:$PORT/api/health")
echo "$HEALTH" | grep -q "bridgeContentionCount" || {
  echo "FAIL: /api/health does not expose bridgeContentionCount"
  exit 1
}
echo "$HEALTH" | grep -q "contendedSessionIds" || {
  echo "FAIL: /api/health does not expose contendedSessionIds"
  exit 1
}

echo "Health: contention counters exposed"
echo "PASS: bridge contention"
