#!/usr/bin/env bash
# Test: the $HOME rendezvous record survives losing its owner.
#
#   X5 — the owner is SIGKILLed (no release hook can run) while one attach
#        instance is alive. The survivor promotes, and the record then names
#        an endpoint that actually answers — not the dead one.
#   X6 — the owner stops CLEANLY while one attach instance is alive. The HOME
#        must still have a resolvable default afterwards; a graceful exit that
#        deletes the record leaves every unpinned bridge with nowhere to go.
#
# Also asserted along the way, because it is the precondition both arms rest
# on and it fails silently: an ATTACH-mode instance must NOT write the record
# (task 2.0c). If it did, "the survivor promoted" would be indistinguishable
# from "the second instance always overwrites".
#
# HERMETIC: every instance runs under its own throwaway $HOME. The record,
# socket and instance id are all per-HOME, so running against the tester's
# real $HOME would fight their live dashboard — and this arm SIGKILLs the
# record owner.
#
# See change: add-pi-gateway-transport-identity (test-plan #X5, #X6 → tasks
# 12.44, 12.45).
set -euo pipefail

echo "=== Test: HOME rendezvous promotion (X5, X6) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"
  exit 0
fi

PORT_A=18810; GATEWAY_A=19810
PORT_B=18811; GATEWAY_B=19811

QA_HOME=""
A_PID=""; B_PID=""

cleanup() {
  [ -n "$A_PID" ] && kill -9 "$A_PID" 2>/dev/null || true
  [ -n "$B_PID" ] && kill -9 "$B_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

meta_path() { echo "$QA_HOME/.pi/dashboard/server.lock.meta.json"; }

# The identity recorded as the current HOME default. Empty when the record is
# absent or unreadable — the caller decides which of those is a failure.
record_identity() {
  node -e "
    const fs = require('fs');
    try {
      const m = JSON.parse(fs.readFileSync('$(meta_path)', 'utf8'));
      process.stdout.write(String(m.identity ?? ''));
    } catch { process.stdout.write(''); }
  "
}

record_pi_port() {
  node -e "
    const fs = require('fs');
    try {
      const m = JSON.parse(fs.readFileSync('$(meta_path)', 'utf8'));
      process.stdout.write(String(m.piPort ?? ''));
    } catch { process.stdout.write(''); }
  "
}

# One field off `/api/health`. The PID matters as much as the id here:
# `pi-dashboard start` DETACHES, so `$!` is the launcher that exits moments
# later, not the server. Killing `$!` reports "No such process" and leaves the
# daemon running — the arm would then measure two live owners.
health_field() {
  curl -s --max-time 5 "http://localhost:$1/api/health" 2>/dev/null |
    node -e "
      let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
        try { process.stdout.write(String(JSON.parse(s)['$2'] ?? '')); }
        catch { process.stdout.write(''); }
      });
    "
}

wait_for_health() {
  local port="$1" waited=0
  while [ "$waited" -lt 90 ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$port/api/health" 2>/dev/null)" = "200" ]; then
      return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

start_instance() {
  local port="$1" gateway="$2" logfile="$3"
  HOME="$QA_HOME" pi-dashboard start --port "$port" --pi-port "$gateway" --no-tunnel \
    > "$logfile" 2>&1 &
}

# Bring up owner A, then attach B under the same HOME. Leaves A_PID/B_PID set.
# A stranger already on our ports would be probed as if it were ours — and
# since it lives under a DIFFERENT $HOME, every record assertion below would
# fail with a confusing "record does not name the owner". Fail on the real
# cause instead. (A previous aborted run of this arm is the usual culprit.)
assert_ports_free() {
  local port
  for port in "$@"; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$port/api/health" 2>/dev/null)" = "200" ]; then
      echo "FAIL: something is already serving on port $port — refusing to test against it"
      exit 1
    fi
  done
}

start_pair() {
  assert_ports_free "$PORT_A" "$PORT_B"
  QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-rendezvous-XXXXXX")"

  start_instance "$PORT_A" "$GATEWAY_A" "$QA_HOME/a.log"
  if ! wait_for_health "$PORT_A"; then
    echo "FAIL: owner instance never became healthy"; sed -n '1,40p' "$QA_HOME/a.log"; exit 1
  fi
  ID_A="$(health_field "$PORT_A" instanceId)"
  A_PID="$(health_field "$PORT_A" pid)"
  [ -n "$ID_A" ] || { echo "FAIL: owner published no instanceId on /api/health"; exit 1; }
  [ -n "$A_PID" ] || { echo "FAIL: owner published no pid on /api/health"; exit 1; }

  if [ "$(record_identity)" != "$ID_A" ]; then
    echo "FAIL: the record does not name the owner (got '$(record_identity)', want '$ID_A')"
    exit 1
  fi

  start_instance "$PORT_B" "$GATEWAY_B" "$QA_HOME/b.log"
  if ! wait_for_health "$PORT_B"; then
    echo "FAIL: attach instance never became healthy"; sed -n '1,40p' "$QA_HOME/b.log"; exit 1
  fi
  ID_B="$(health_field "$PORT_B" instanceId)"
  B_PID="$(health_field "$PORT_B" pid)"
  [ -n "$ID_B" ] || { echo "FAIL: attach instance published no instanceId"; exit 1; }
  [ "$ID_A" != "$ID_B" ] || { echo "FAIL: both instances report the same id — the id is not per-instance"; exit 1; }

  # Precondition, and a real assertion: attach mode must leave the record alone.
  if [ "$(record_identity)" != "$ID_A" ]; then
    echo "FAIL: an attach-mode instance rewrote the record (task 2.0c)"
    exit 1
  fi
  echo "  owner=$ID_A attach=$ID_B — record names the owner"
}

# Poll the record until it names $1, or give up. Promotion polls on a 15 s
# interval (DEFAULT_PROMOTION_INTERVAL_MS), so 60 s is four chances.
await_promotion() {
  local want="$1" waited=0
  while [ "$waited" -lt 60 ]; do
    [ "$(record_identity)" = "$want" ] && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

# Prove the promoted endpoint ANSWERS. `ws` is a server dependency but may not
# resolve from this cwd on a clean VM; a missing module is a skip, never a
# silent pass (03-websocket.sh sets the precedent).
assert_socket_answers() {
  local sock="$QA_HOME/.pi/dashboard/gateway-$1.sock"
  if [ ! -S "$sock" ]; then
    echo "FAIL: promoted instance has no gateway socket at $sock"
    exit 1
  fi
  if node -e "require('ws')" 2>/dev/null; then
    node -e "
      const WebSocket = require('ws');
      const ws = new WebSocket('ws+unix://$sock:/');
      const t = setTimeout(() => { console.error('dial timeout'); process.exit(1); }, 8000);
      ws.on('open', () => { clearTimeout(t); ws.close(); process.exit(0); });
      ws.on('error', (e) => { clearTimeout(t); console.error('dial error:', e.message); process.exit(1); });
    " || { echo "FAIL: the promoted endpoint does not answer"; exit 1; }
    echo "  promoted endpoint answers on gateway-$1.sock"
  else
    echo "  NOTE: ws module unavailable — socket existence checked, dial skipped"
  fi
}

# ── X5: the owner is killed outright ────────────────────────────────────────
echo "-- X5: SIGKILLed owner, survivor promotes"
start_pair
kill -9 "$A_PID"; A_PID=""
if ! await_promotion "$ID_B"; then
  echo "FAIL: no promotion within 60 s — the record still names '$(record_identity)'"
  echo "      (an unpinned bridge would dial the dead owner forever)"
  exit 1
fi
[ "$(record_pi_port)" = "$GATEWAY_B" ] || {
  echo "FAIL: the record was promoted but still points at gateway port '$(record_pi_port)'"
  exit 1
}
assert_socket_answers "$GATEWAY_B"
cleanup; A_PID=""; B_PID=""; QA_HOME=""

# ── X6: the owner leaves politely ───────────────────────────────────────────
# A clean exit runs the release hook, so this arm is NOT a repeat of X5: the
# hazard here is the opposite one — the owner removing the record on its way
# out and leaving the HOME with no default at all while B is still serving.
echo "-- X6: cleanly stopped owner, HOME keeps a resolvable default"
start_pair
kill -TERM "$A_PID"
waited=0
while kill -0 "$A_PID" 2>/dev/null && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited + 1)); done
kill -0 "$A_PID" 2>/dev/null && { echo "FAIL: owner ignored SIGTERM"; exit 1; }
A_PID=""

if ! await_promotion "$ID_B"; then
  echo "FAIL: after a clean shutdown the HOME default is '$(record_identity)', not the live survivor"
  exit 1
fi
assert_socket_answers "$GATEWAY_B"

echo "PASS: the rendezvous record survives both a crash and a clean exit"
