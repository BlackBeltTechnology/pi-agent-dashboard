#!/usr/bin/env bash
# L2: relayed loopback is never trusted on a LIVE process (test-plan #X1).
#
# A tunnel agent (zrok, ngrok, `tailscale serve`) relays from a 127.0.0.1
# socket and injects X-Forwarded-*. With `trustedNetworks: ["127.0.0.1"]` the
# relayed request used to be admitted unauthenticated. Proves on a real server:
#   1. PUT /api/config trustedNetworks ["127.0.0.1"] from loopback -> 200 (live, no restart)
#   2. GET /api/sessions + X-Forwarded-For -> 403 network_not_allowed
#   3. GET /api/sessions without the header (genuine local) -> 200
#   4. restore the original trustedNetworks -> 200
#
# Server must be up (started by 02-server-start.sh). QA_BASE overrides the URL.
# See change: fix-trusted-network-tunnel-bypass.
set -euo pipefail

echo "=== Test: relayed loopback not trusted by a loopback trustedNetworks entry ==="

BASE="${QA_BASE:-http://localhost:8000}"
fail() { echo "FAIL: $*" >&2; exit 1; }

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
[ "$HTTP_CODE" = "200" ] || fail "Server not running (health returned $HTTP_CODE)"

# Remember the current top-level trustedNetworks (JSON array) to restore it.
ORIG=$(curl -fsS --max-time 10 "$BASE/api/config" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const c=j.data??j;process.stdout.write(JSON.stringify(c.trustedNetworks??[]))})")

put_trusted() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X PUT "$BASE/api/config" \
    -H "Content-Type: application/json" -d "{\"trustedNetworks\":$1}"
}
restore() { put_trusted "$ORIG" >/dev/null 2>&1 || true; }
trap restore EXIT

CODE=$(put_trusted '["127.0.0.1"]')
[ "$CODE" = "200" ] || fail "PUT /api/config trustedNetworks returned $CODE"

BODY_FILE=$(mktemp)
CODE=$(curl -s -o "$BODY_FILE" -w "%{http_code}" --max-time 10 \
  -H "X-Forwarded-For: 203.0.113.9" "$BASE/api/sessions")
[ "$CODE" = "403" ] || fail "relayed GET /api/sessions returned $CODE (expected 403)"
grep -q "network_not_allowed" "$BODY_FILE" || fail "relayed 403 body lacks network_not_allowed: $(cat "$BODY_FILE")"
rm -f "$BODY_FILE"
echo "relayed loopback: 403 network_not_allowed"

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE/api/sessions")
[ "$CODE" = "200" ] || fail "genuine-local GET /api/sessions returned $CODE (expected 200)"
echo "genuine local: 200"

trap - EXIT
CODE=$(put_trusted "$ORIG")
[ "$CODE" = "200" ] || fail "restore PUT /api/config returned $CODE"
echo "restore: 200"

echo "PASS: loopback trusted entry does not admit tunnel-relayed requests"
