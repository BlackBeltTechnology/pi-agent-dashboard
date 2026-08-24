#!/usr/bin/env bash
# Test: on POSIX, a default start binds NO bridge TCP port at all.
#
# The socket is the point. If a default start still opened a loopback TCP
# listener "just in case", every claim this change makes about the kernel
# deciding who may connect (D5) would be decoration over an open port that
# anything on the host could reach. The absence of that listener IS the
# feature, so it has to be asserted rather than assumed.
#
# Runs on macOS and Linux — the same assertion on both, which is the other
# half of task 13.8 (its Windows twin is `28-gateway-windows.ps1`, where the
# expectation is inverted: Windows has no UDS path and MUST bind loopback).
#
# tasks 13.8, 2.9 · test-plan #X16
# See change: add-pi-gateway-transport-identity.

set -u

PORT="${DASHBOARD_PORT:-18850}"
GATEWAY="${PI_GATEWAY_PORT:-19850}"
QA_HOME=""
SRV_PID=""

echo "=== Test: a POSIX default start binds no bridge TCP port ==="

cleanup() {
  if [ -n "$SRV_PID" ]; then kill -9 "$SRV_PID" 2>/dev/null || true; fi
  if [ -n "$QA_HOME" ]; then rm -rf "$QA_HOME" 2>/dev/null || true; fi
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT — refusing to test against it"
  exit 1
fi

# Hermetic HOME: the endpoint, the record and the socket all resolve from it,
# so a shared HOME would let a developer's own dashboard answer for us.
QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-posix-notcp-XXXXXX")"

# DEFAULT start — no PI_GATEWAY_TCP, no flags asking for a listener. That is
# the configuration under test; anything else would prove a different one.
HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
if [ "$WAITED" -ge 90 ]; then
  echo "FAIL: the dashboard never started"
  sed -n '1,40p' "$QA_HOME/start.log"
  exit 1
fi

HEALTH="$(curl -s --max-time 5 "http://localhost:$PORT/api/health")"
SRV_PID="$(printf '%s' "$HEALTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).pid??''))}catch{process.stdout.write('')}})")"

# 1 — the advertised endpoint is a SOCKET PATH, not a port number.
GATEWAY_FIELD="$(printf '%s' "$HEALTH" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    const v = JSON.parse(s).piGatewayPort;
    process.stdout.write(typeof v + ':' + String(v));
  });
")"
case "$GATEWAY_FIELD" in
  string:*gateway-*.sock) echo "  /api/health advertises a unix socket: ${GATEWAY_FIELD#string:}" ;;
  *)
    echo "FAIL: expected a socket path on /api/health, got '$GATEWAY_FIELD'"
    echo "      (a port here means the default start fell back to TCP on a platform that supports UDS)"
    exit 1
    ;;
esac

SOCK="${GATEWAY_FIELD#string:}"
if [ ! -S "$SOCK" ]; then
  echo "FAIL: /api/health names '$SOCK' but there is no socket there"
  exit 1
fi

# 2 — the load-bearing assertion: NOTHING is listening on the gateway port.
#     Checked two ways, because each alone has a blind spot: `lsof` can be
#     absent or restricted, and a connect probe cannot distinguish "refused"
#     from "firewalled". Agreement between them is what makes this safe to
#     trust as a negative.
if command -v lsof > /dev/null 2>&1; then
  if lsof -nP -iTCP:"$GATEWAY" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "FAIL: a TCP listener is bound on $GATEWAY after a DEFAULT start"
    lsof -nP -iTCP:"$GATEWAY" -sTCP:LISTEN 2>/dev/null | sed -n '1,5p'
    exit 1
  fi
  echo "  lsof: no TCP listener on $GATEWAY"
else
  echo "  lsof unavailable — relying on the connect probe alone"
fi

CONNECT="$(node -e "
  const net = require('net');
  const s = net.connect($GATEWAY, '127.0.0.1');
  const done = (v) => { process.stdout.write(v); process.exit(0); };
  s.on('connect', () => done('connected'));
  s.on('error', () => done('refused'));
  setTimeout(() => done('timeout'), 3000);
" 2>/dev/null)"
if [ "$CONNECT" = "connected" ]; then
  echo "FAIL: 127.0.0.1:$GATEWAY accepted a TCP connection after a DEFAULT start"
  echo "      (the socket is not the only door — D5's kernel check can be bypassed)"
  exit 1
fi
echo "  connect probe on 127.0.0.1:$GATEWAY: $CONNECT"

# 3 — and the socket that replaced it is actually usable, or the absence
#     above would just be a broken gateway rather than a private one.
BRIDGE="$(SOCK="$SOCK" node -e "
  const WebSocket = require('ws');
  const url = 'ws+unix://' + process.env.SOCK + ':/';
  const ws = new WebSocket(url);
  const done = (v) => { process.stdout.write(v); process.exit(0); };
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'session_register', sessionId: 'qa-posix-notcp-' + process.pid, cwd: process.cwd(), source: 'tui', pid: process.pid }));
    setTimeout(() => done('registered'), 800);
  });
  ws.on('error', (e) => done('error:' + e.message));
  setTimeout(() => done('timeout'), 8000);
" 2>/dev/null)"
if [ "$BRIDGE" != "registered" ]; then
  echo "FAIL: the unix socket did not accept a bridge ($BRIDGE)"
  exit 1
fi
echo "  a bridge registered over the socket"

echo "PASS: no bridge TCP port on a POSIX default start; the socket carries it"
