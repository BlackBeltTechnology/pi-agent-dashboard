#!/usr/bin/env bash
# Test: under the strict `requireLocalProof` default a bare curl to an operate route is refused, and
# `pi-dashboard api` (which mints local proof) is admitted and really restarts the server (test-plan #X7).
#
#   bare   curl -X POST http://127.0.0.1:$PORT/api/restart -> 403, reason local_proof_required, NO restart
#   CLI    pi-dashboard api POST /api/restart             -> exit 0, a NEW server process answers /api/health
#
# Assumes the dashboard is already running with the DEFAULT config (as 39-cli-open.sh does).
# See change: close-container-loopback-impersonation (D1, D4).
set -euo pipefail

echo "=== Test: strict default + pi-dashboard api ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${PI_DASHBOARD_PORT:-8000}"

ident() {
  curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.pid+'@'+j.startedAt)})"
}

BEFORE="$(ident)" || { echo "FAIL: server not running on port $PORT"; exit 1; }

# 1. A bare loopback curl is refused — and nothing restarts.
BODY="$(mktemp)"
CODE="$(curl -s -o "$BODY" -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/restart" || true)"
if [ "$CODE" != "403" ] || ! grep -q 'local_proof_required' "$BODY"; then
  echo "FAIL: bare POST /api/restart returned HTTP $CODE (expected 403 local_proof_required): $(head -c 300 "$BODY")"
  rm -f "$BODY"
  exit 1
fi
rm -f "$BODY"
sleep 2
if [ "$(ident)" != "$BEFORE" ]; then
  echo "FAIL: the refused request restarted the server anyway"
  exit 1
fi
echo "OK: bare curl refused (403 local_proof_required), server untouched"

# 2. The CLI mints local proof: admitted, and a new server process comes up.
pi-dashboard api GET /api/health --port "$PORT" >/dev/null || { echo "FAIL: pi-dashboard api GET /api/health did not exit 0"; exit 1; }
pi-dashboard api POST /api/restart --port "$PORT" >/dev/null || { echo "FAIL: pi-dashboard api POST /api/restart did not exit 0"; exit 1; }
for _ in $(seq 1 45); do
  sleep 2
  AFTER="$(ident 2>/dev/null || true)"
  if [ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ]; then
    echo "OK: pi-dashboard api POST /api/restart restarted the server ($BEFORE -> $AFTER)"
    echo "PASS"
    exit 0
  fi
done
echo "FAIL: no replacement server observed after pi-dashboard api POST /api/restart"
exit 1
