#!/usr/bin/env bash
# Test: `pi-dashboard open --print` mints a one-time local-proof URL (test-plan #X15).
# Server up  -> stdout matches /auth/local-proof?code=<43 base64url>, exit 0.
# Server down-> exit 1, output contains "server not running".
# See change: harden-trust-and-credential-boundaries.
set -euo pipefail

echo "=== Test: pi-dashboard open --print ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${PI_DASHBOARD_PORT:-8000}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Server not running (health returned $HTTP_CODE)"
  exit 1
fi

OUT=$(pi-dashboard open --print --port "$PORT")
if ! echo "$OUT" | grep -Eq "^http://localhost:$PORT/auth/local-proof\?code=[A-Za-z0-9_-]{43}$"; then
  echo "FAIL: unexpected output: $OUT"
  exit 1
fi
echo "OK: server up -> $OUT"

# Server-down half: a port nothing listens on.
DEAD_PORT=$((PORT + 4321))
set +e
DOWN=$(pi-dashboard open --print --port "$DEAD_PORT" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 1 ] || ! echo "$DOWN" | grep -q "server not running"; then
  echo "FAIL: expected exit 1 + 'server not running', got rc=$RC out=$DOWN"
  exit 1
fi
echo "OK: server down -> exit 1"

# X8 (loopback-credential-proof): the other local CLI verbs are admitted on a
# PROOF alone — all exit 0 and none sends the deprecated raw X-Pi-Local-Token.
LOG="$HOME/.pi/dashboard/server.log"
BEFORE=$(grep -c "DEPRECATED raw X-Pi-Local-Token accepted from a http caller" "$LOG" 2>/dev/null || echo 0)
pi-dashboard login --local --port "$PORT" >/dev/null || { echo "FAIL: login --local did not exit 0"; exit 1; }
pi-dashboard token create --label qa-proof --port "$PORT" >/dev/null || { echo "FAIL: token create did not exit 0"; exit 1; }
pi-dashboard service list --port "$PORT" >/dev/null || { echo "FAIL: service list did not exit 0"; exit 1; }
AFTER=$(grep -c "DEPRECATED raw X-Pi-Local-Token accepted from a http caller" "$LOG" 2>/dev/null || echo 0)
if [ "$AFTER" != "$BEFORE" ]; then
  echo "FAIL: a CLI verb sent the deprecated raw X-Pi-Local-Token ($BEFORE -> $AFTER deprecation lines)"
  exit 1
fi
pi-dashboard restart --port "$PORT" >/dev/null || { echo "FAIL: restart did not exit 0"; exit 1; }
echo "OK: login/token/service/restart admitted on a proof, no raw-token deprecation lines"
echo "PASS"
