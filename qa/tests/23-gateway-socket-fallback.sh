#!/usr/bin/env bash
# Test: when a unix socket is unrepresentable, the gateway falls back to
# loopback + local token — and NEVER to discovery.
#
# X17. The hazard is not "no socket"; it is what replaces it. Reintroducing
# name→endpoint discovery as the fallback would put back exactly the
# indirection this change removed (D15), and it would do so silently, on the
# machines least able to notice.
#
# HOW THE CONDITION IS PRODUCED, and its limit — stated rather than implied.
# `resolveLocalGatewayEndpoint` decides by measuring the socket path against
# the platform's `sun_path` capacity (104 bytes on macOS/BSD, 108 on Linux).
# A deep $HOME therefore reproduces the real branch exactly. It does NOT
# reproduce "the filesystem cannot host a socket at all": nothing in
# `dashboard-paths.ts` probes the filesystem, so that half of task 2.1b has no
# implementation to test and is NOT covered here.
#
# See change: add-pi-gateway-transport-identity (test-plan #X17 → task 12.46).
set -euo pipefail

echo "=== Test: gateway socket fallback (X17) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"
  exit 0
fi

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "SKIP: POSIX-only (Windows never uses a unix socket by design, D6)"; exit 0 ;;
esac

PORT=18812
GATEWAY=19812
DEEP_ROOT=""
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  [ -n "$DEEP_ROOT" ] && rm -rf "$DEEP_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT — refusing to test against it"
  exit 1
fi

# A $HOME deep enough that `<HOME>/.pi/dashboard/gateway-<port>.sock` cannot
# fit in `sun_path`. Two 40-byte segments clear the 104-byte limit on every
# supported platform with room to spare.
DEEP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/qa-sockfallback-XXXXXX")"
SEG="$(printf 'd%.0s' $(seq 1 40))"
DEEP_HOME="$DEEP_ROOT/$SEG/$SEG"
mkdir -p "$DEEP_HOME"

HOME="$DEEP_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$DEEP_ROOT/start.log" 2>&1 &

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
if [ "$WAITED" -ge 90 ]; then
  echo "FAIL: the dashboard never started under a deep \$HOME"
  echo "      (a fallback that cannot boot is worse than the socket it replaced)"
  sed -n '1,40p' "$DEEP_ROOT/start.log"
  exit 1
fi

HEALTH="$(curl -s --max-time 5 "http://localhost:$PORT/api/health")"
SRV_PID="$(printf '%s' "$HEALTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).pid??''))}catch{process.stdout.write('')}})")"

# 1 — the advertised endpoint is a PORT, not a socket path. This is the field
#     the settings UI renders; a string here would mean the socket won.
GATEWAY_FIELD="$(printf '%s' "$HEALTH" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    const v = JSON.parse(s).piGatewayPort;
    process.stdout.write(typeof v + ':' + String(v));
  });
")"
if [ "$GATEWAY_FIELD" != "number:$GATEWAY" ]; then
  echo "FAIL: expected a loopback port on /api/health, got '$GATEWAY_FIELD'"
  exit 1
fi
echo "  /api/health reports the loopback port, not a socket path"

# 2 — no socket file was left behind under the deep HOME.
if compgen -G "$DEEP_HOME/.pi/dashboard/gateway-*.sock" > /dev/null; then
  echo "FAIL: a socket file exists despite the fallback"
  exit 1
fi

# 3 — the listener is on 127.0.0.1, not 0.0.0.0. "Loopback + local token" is
#     the whole claim; a wildcard bind would publish an authenticated-by-token
#     gateway to the network instead.
if command -v lsof >/dev/null 2>&1; then
  BIND="$(lsof -nP -iTCP:"$GATEWAY" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | head -1)"
  case "$BIND" in
    127.0.0.1:"$GATEWAY"|localhost:"$GATEWAY") echo "  bridge listener is bound to $BIND" ;;
    "") echo "FAIL: nothing is listening on the advertised gateway port $GATEWAY"; exit 1 ;;
    *) echo "FAIL: the fallback listener is bound to '$BIND', not loopback"; exit 1 ;;
  esac
else
  echo "  NOTE: lsof unavailable — bind address not asserted"
fi

# 4 — the log names the ACTUAL cause. A generic "socket unavailable" leaves an
#     operator with nothing to act on; the byte count and the limit are what
#     make the deep-$HOME diagnosis possible at all.
LOG="$DEEP_HOME/.pi/dashboard/server.log"
if [ ! -f "$LOG" ]; then
  echo "FAIL: no server.log under the deep \$HOME"
  exit 1
fi
if ! grep -q "sun_path limit" "$LOG"; then
  echo "FAIL: server.log does not name the sun_path limit as the cause"
  grep -i "socket\|gateway" "$LOG" | head -5
  exit 1
fi
if ! grep -q "falling back to loopback + local token" "$LOG"; then
  echo "FAIL: server.log does not record the loopback fallback"
  exit 1
fi
echo "  server.log names the sun_path overflow and the loopback fallback"

# 5 — and it did NOT fall back to discovery. Asserted by absence, which is
#     weak on its own; it is paired with assertion 1, where a discovery-based
#     fallback could not have produced a fixed loopback port.
if grep -iE "gateway.*(mdns|bonjour|_pi-dashboard\._tcp|discovery)" "$LOG" > /dev/null; then
  echo "FAIL: the gateway reached for discovery as a fallback"
  grep -iE "gateway.*(mdns|bonjour|discovery)" "$LOG" | head -3
  exit 1
fi

echo "PASS: unrepresentable socket path falls back to loopback + token, not discovery"
