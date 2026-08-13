#!/usr/bin/env bash
# Test: a losing dashboard server leaves NO port held.
#
# Scenarios E1 + E22 (test-plan: fix-worktree-server-autostart-leak).
#   E1  — server B starts against an occupied gateway port; a later startup
#         step fails; B must exit non-zero and leave only A's pid listening.
#   E22 — invariant: no process may hold the gateway port while never having
#         bound its dashboard port (the captured PID-78379 signature).
#
# See change: fix-worktree-server-autostart-leak.
set -euo pipefail

echo "=== Test: Server port hygiene (E1, E22) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v lsof >/dev/null 2>&1; then
  echo "SKIP: lsof unavailable, cannot assert port ownership"
  exit 0
fi

PORT_A=18400
GATEWAY_A=19400
# Server B gets its OWN free gateway port and A's OCCUPIED dashboard port.
# That is the E1 shape exactly: B's gateway binds fine, and the LATER
# `fastify.listen()` step fails — so the teardown under test is the only thing
# that can release B's gateway port. (Giving B both of A's ports instead would
# fail at the first bind and pass even with the fix reverted.)
GATEWAY_B=19401

holders() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u; }

cleanup() {
  [ -n "${A_PID:-}" ] && kill "$A_PID" 2>/dev/null || true
  [ -n "${B_PID:-}" ] && kill "$B_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

# ── Server A: the incumbent ────────────────────────────────────────────────
pi-dashboard --port "$PORT_A" --pi-port "$GATEWAY_A" &
A_PID=$!

ELAPSED=0
while [ $ELAPSED -lt 30 ]; do
  if [ "$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT_A}/api/health" || echo 000)" = "200" ]; then
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
if [ $ELAPSED -ge 30 ]; then
  echo "FAIL: incumbent server A never became healthy on ${PORT_A}"
  exit 1
fi
echo "Server A healthy on ${PORT_A} (gateway ${GATEWAY_A})"

# ── Server B: own gateway, A's dashboard port — must lose and leave nothing ─
pi-dashboard --port "$PORT_A" --pi-port "$GATEWAY_B" &
B_PID=$!

# Observe steady state. The startup deadline is 30s, so 60s covers a bounded
# teardown with margin.
sleep 60

if kill -0 "$B_PID" 2>/dev/null; then
  echo "FAIL (E1): server B (pid $B_PID) is still resident 60s after losing both ports"
  lsof -nP -p "$B_PID" -iTCP -sTCP:LISTEN || true
  exit 1
fi
echo "Server B exited rather than lingering"

GATEWAY_A_HOLDERS=$(holders "$GATEWAY_A")
GATEWAY_B_HOLDERS=$(holders "$GATEWAY_B")
DASH_HOLDERS=$(holders "$PORT_A")
echo "Gateway A ${GATEWAY_A} holders: ${GATEWAY_A_HOLDERS:-none}"
echo "Gateway B ${GATEWAY_B} holders: ${GATEWAY_B_HOLDERS:-none}"
echo "Dashboard ${PORT_A} holders: ${DASH_HOLDERS:-none}"

# E1: B's gateway port must have been RELEASED by the teardown.
if [ -n "$GATEWAY_B_HOLDERS" ]; then
  echo "FAIL (E1): gateway ${GATEWAY_B} is still held after B lost the dashboard port: ${GATEWAY_B_HOLDERS}"
  exit 1
fi

if [ "$(echo "$GATEWAY_A_HOLDERS" | grep -c . || true)" != "1" ]; then
  echo "FAIL (E1): expected exactly one holder of A's gateway, got: ${GATEWAY_A_HOLDERS:-none}"
  exit 1
fi

# E22: every gateway-port holder must ALSO hold its dashboard port.
for PID in $GATEWAY_A_HOLDERS $GATEWAY_B_HOLDERS; do
  if ! echo "$DASH_HOLDERS" | grep -qx "$PID"; then
    echo "FAIL (E22): pid $PID holds a gateway port but never bound dashboard ${PORT_A}"
    exit 1
  fi
done

echo "PASS: no listener-less residue; every gateway holder serves its dashboard port"
exit 0
