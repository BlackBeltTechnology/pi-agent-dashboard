#!/usr/bin/env bash
# Test: WebSocket connections to pi gateway and browser gateway
set -euo pipefail

echo "=== Test: WebSocket connections ==="

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Ensure server is running (started by previous test)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Server not running (health returned $HTTP_CODE)"
  exit 1
fi

# Test pi gateway WebSocket (port 9999)
# Use a simple Node.js script to attempt connection
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9999');
const timeout = setTimeout(() => { console.error('Pi gateway timeout'); process.exit(1); }, 5000);
ws.on('open', () => { clearTimeout(timeout); console.log('Pi gateway: connected'); ws.close(); });
ws.on('error', (e) => { clearTimeout(timeout); console.error('Pi gateway error:', e.message); process.exit(1); });
ws.on('close', () => { process.exit(0); });
" || {
  # ws module might not be available globally, try with fetch-based check
  echo "NOTE: ws module not available, checking port connectivity"
  if curl -s --max-time 5 http://localhost:9999 >/dev/null 2>&1 || [ $? -eq 52 ]; then
    echo "Pi gateway: port 9999 accepting connections"
  else
    echo "FAIL: Pi gateway not accepting connections on port 9999"
    exit 1
  fi
}

# Test browser WebSocket (port 8000, /ws path)
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8000/ws');
const timeout = setTimeout(() => { console.error('Browser WS timeout'); process.exit(1); }, 5000);
ws.on('open', () => { clearTimeout(timeout); console.log('Browser WS: connected'); ws.close(); });
ws.on('error', (e) => { clearTimeout(timeout); console.error('Browser WS error:', e.message); process.exit(1); });
ws.on('close', () => { process.exit(0); });
" || {
  echo "NOTE: ws module not available, checking port connectivity"
  if curl -s --max-time 5 -o /dev/null -w "%{http_code}" http://localhost:8000/ws 2>/dev/null; then
    echo "Browser WS: port 8000 accepting connections"
  else
    echo "FAIL: Browser WS not accepting connections"
    exit 1
  fi
}

# X8 — a bridge-reported inbound drop must reach server.log.
#
# The drop sites' own `console.error` lands in /dev/null whenever
# `keeperLog.capturePiOutput` is false (the DEFAULT), so the socket report is
# the only record an operator can read. Routing id is the reporting bridge's
# own session; the id the dropped message named rides as payload.
# See change: fix-spawn-correlation-ttl-coupling (D6).
LOG_PATH="$HOME/.pi/dashboard/server.log"
# Detect the `ws` dependency FIRST: without this, a missing module prints the
# skip note and then the grep below still fails the run, conflating "cannot
# test" with "the report never arrived". Connection/timeout failures stay fatal.
if [ -f "$LOG_PATH" ] && node -e "require('ws')" 2>/dev/null; then
  DROP_SESSION="qa-drop-$$"
  node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9999');
const timeout = setTimeout(() => { console.error('drop-report timeout'); process.exit(1); }, 5000);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'session_register', sessionId: '$DROP_SESSION', cwd: process.cwd(), source: 'tui' }));
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'inbound_drop_report',
      sessionId: '$DROP_SESSION',
      dropClass: 'session_mismatch',
      messageType: 'send_prompt',
      droppedSessionId: 'qa-not-mine',
    }));
    setTimeout(() => { clearTimeout(timeout); ws.close(); process.exit(0); }, 500);
  }, 500);
});
ws.on('error', (e) => { clearTimeout(timeout); console.error('drop-report error:', e.message); process.exit(1); });
"

  sleep 1
  if grep -q "bridge-drop.*$DROP_SESSION" "$LOG_PATH"; then
    echo "Drop report: recorded in server.log"
  else
    echo "FAIL: bridge drop report never reached server.log"
    exit 1
  fi
else
  echo "NOTE: server.log or ws module unavailable, skipping drop-report check"
fi

echo "PASS: WebSocket connections successful"
