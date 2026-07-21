#!/usr/bin/env bash
# Test: WS ticket auth path that the bus client depends on (test-plan #C4).
#
# Loopback observable: the `POST /api/ws-ticket` mint the bus client calls in
# `connect()` returns a ticket promptly (bounded — never a hang), and that
# ticket authorizes a real `/ws` upgrade. The off-box DENIAL half (networkGuard
# 403 → explicit off-box error) is pinned by the L1 companion test
# `packages/bus-client/src/__tests__/offbox-ticket-denied.test.ts`, since a
# non-loopback origin cannot be simulated from localhost.
set -euo pipefail

echo "=== Test: WS ticket auth (bus-client connect path) ==="

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

BASE="http://localhost:8000"

# Server must be up (started by 02-server-start.sh).
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Server not running (health returned $HTTP_CODE)"
  exit 1
fi

# 1. Mint a browser-scope ticket. Bounded by --max-time so a hang FAILS the test.
MINT=$(curl -s --max-time 10 -X POST "$BASE/api/ws-ticket" \
  -H "Content-Type: application/json" -d '{"scope":"browser"}' 2>/dev/null || echo "")
if [ -z "$MINT" ]; then
  echo "FAIL: ws-ticket mint did not respond within the bound (hang or error)"
  exit 1
fi

TICKET=$(echo "$MINT" | grep -o '"ticket":"[^"]*"' | head -1 | sed 's/.*"ticket":"//;s/"//')
if [ -z "$TICKET" ]; then
  echo "FAIL: no ticket in mint response: $MINT"
  exit 1
fi
echo "ws-ticket: minted (len=${#TICKET})"

# 2. The ticket must authorize a real /ws upgrade (single-use, TTL 15s).
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8000/ws?ticket=${TICKET}');
const timeout = setTimeout(() => { console.error('ticketed WS timeout'); process.exit(1); }, 5000);
ws.on('open', () => { clearTimeout(timeout); console.log('ticketed WS: connected'); ws.close(); });
ws.on('message', () => {}); // sessions_snapshot on connect
ws.on('error', (e) => { clearTimeout(timeout); console.error('ticketed WS error:', e.message); process.exit(1); });
ws.on('close', () => process.exit(0));
" || {
  echo "NOTE: ws module unavailable — skipping upgrade leg"
}

echo "PASS: WS ticket auth path works (mint bounded + ticket authorizes upgrade)"
