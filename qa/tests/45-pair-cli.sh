#!/usr/bin/env bash
# L2 smoke: `pi-dashboard pair list` / `pair approve` against a REAL server on
# loopback with its REAL local token (test-plan #X27).
#
# A device "knocks" over the host's private LAN address (the only credential-free
# entry a bare VM has: a QR payload needs a public https origin). The operator
# half then runs entirely through the CLI, the way a headless / SSH / `docker exec`
# user would: list the pending request, approve it with the digits the device was
# shown.
#   list     -> exit 0; prints the pendingId; prints NO confirmation code
#   approve  -> exit 0; server.log has `[pairing] approved`
#   wrong 8 digits -> exit 3; non-8-digit -> exit 2 (nothing sent)
#
# Isolation: own temp HOME + non-8000 ports, so the operator's dashboard is never
# stopped or shadowed. Override the launcher with PI_DASHBOARD_CMD and the port
# with QA_PORT. SKIPs (exit 0) when the host has no private LAN IPv4 address.
#
# See change: fix-pairing-approval-credential.
set -euo pipefail

echo "=== Test: pi-dashboard pair list / approve ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${QA_PORT:-18345}"
PI_PORT="${QA_PI_PORT:-19345}"
read -r -a DASH <<<"${PI_DASHBOARD_CMD:-pi-dashboard}"

WORKDIR="$(mktemp -d)"
QA_HOME="$WORKDIR/home"
fail() { echo "FAIL: $*" >&2; exit 1; }
stop_dash() { HOME="$QA_HOME" PI_DASHBOARD_HOST=0.0.0.0 "${DASH[@]}" stop --port "$PORT" --pi-port "$PI_PORT" >/dev/null 2>&1 || true; }
cleanup() { stop_dash; rm -rf "$WORKDIR"; }
trap cleanup EXIT

# `jq` is not guaranteed on every QA image; node always is.
jnode() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(String($1))})"; }

# First private, non-loopback IPv4 address of this host.
LAN_IP="$(node -e '
const os = require("node:os");
const priv = (a) => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
for (const list of Object.values(os.networkInterfaces()))
  for (const i of list || []) if (i.family === "IPv4" && !i.internal && priv(i.address)) { console.log(i.address); process.exit(0); }
')"
if [ -z "$LAN_IP" ]; then
  echo "SKIP: no private LAN IPv4 address on this host (a knock needs an on-link private peer)"
  exit 0
fi

mkdir -p "$QA_HOME/.pi/dashboard"
printf '%s' '{"pairing":{"acceptLanRequests":true}}' >"$QA_HOME/.pi/dashboard/config.json"
env HOME="$QA_HOME" PI_DASHBOARD_HOST=0.0.0.0 "${DASH[@]}" start --port "$PORT" --pi-port "$PI_PORT" --no-tunnel >"$WORKDIR/start.log" 2>&1 &
waited=0
until curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge 40 ]; then cat "$WORKDIR/start.log" >&2; fail "server did not become healthy on :$PORT"; fi
done

pair() { HOME="$QA_HOME" "${DASH[@]}" pair "$@" --port "$PORT"; }

# Nothing pending yet.
EMPTY="$(pair list)" || fail "pair list on an empty server did not exit 0"
echo "$EMPTY" | grep -q "no pending" || fail "expected 'no pending', got: $EMPTY"

# The device knocks over the LAN address and is shown its 8-digit code.
KNOCK="$(curl -fsS -X POST "http://$LAN_IP:$PORT/api/pair/request" -H 'content-type: application/json' -d '{"name":"qa-phone"}')" \
  || fail "knock over $LAN_IP:$PORT was refused (acceptLanRequests / LAN gate)"
PENDING_ID="$(printf '%s' "$KNOCK" | jnode 'j.data.pendingId')"
CODE="$(printf '%s' "$KNOCK" | jnode 'j.data.confirmCode')"
[ -n "$PENDING_ID" ] && [[ "$CODE" =~ ^[0-9]{8}$ ]] || fail "unexpected knock reply: $KNOCK"

# list: shows the request, never the code.
LIST="$(pair list)" || fail "pair list did not exit 0"
echo "$LIST" | grep -q "$PENDING_ID" || fail "pair list does not show $PENDING_ID: $LIST"
echo "$LIST" | grep -q "qa-phone" || fail "pair list does not show the requester name: $LIST"
if echo "$LIST" | grep -q "$CODE"; then fail "pair list printed the confirmation code"; fi
JSON="$(pair list --json)" || fail "pair list --json did not exit 0"
if echo "$JSON" | grep -q "$CODE"; then fail "pair list --json printed the confirmation code"; fi
echo "OK: pair list shows the request, no code"

# Malformed code: refused locally (exit 2), nothing spent.
set +e
BAD="$(pair approve "$PENDING_ID" --code 1234 2>&1)"; RC=$?
set -e
[ "$RC" -eq 2 ] || fail "expected exit 2 for a 4-digit code, got $RC: $BAD"

# Wrong 8 digits: refused by the server (exit 3), reports attempts left.
WRONG="00000000"; [ "$CODE" = "$WRONG" ] && WRONG="11111111"
set +e
MISMATCH="$(pair approve "$PENDING_ID" --code "$WRONG" 2>&1)"; RC=$?
set -e
[ "$RC" -eq 3 ] || fail "expected exit 3 for a wrong code, got $RC: $MISMATCH"
echo "$MISMATCH" | grep -q "attempts left" || fail "mismatch did not report attempts left: $MISMATCH"

# The right code, piped on stdin (keeps it out of argv).
APPROVED="$(printf '%s\n' "$CODE" | pair approve "$PENDING_ID" --name qa-phone 2>&1)" || fail "pair approve did not exit 0: $APPROVED"
if echo "$APPROVED" | grep -q "$CODE"; then fail "pair approve echoed the confirmation code"; fi
LOG="$QA_HOME/.pi/dashboard/server.log"
waited=0
until grep -q "\[pairing\] approved" "$LOG" 2>/dev/null; do
  sleep 1
  waited=$((waited + 1))
  [ "$waited" -ge 10 ] && fail "server.log has no '[pairing] approved' line ($LOG)"
done
echo "OK: pair approve -> exit 0, server.log has [pairing] approved"

# Resolved: nothing left to list.
AFTER="$(pair list)" || fail "pair list after approval did not exit 0"
echo "$AFTER" | grep -q "no pending" || fail "request still pending after approval: $AFTER"
echo "PASS"
