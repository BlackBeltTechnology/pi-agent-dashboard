#!/usr/bin/env bash
# Test: `/dashboard-where` answers "which dashboard am I actually on?"
#
# F7. A session that has been silently re-targeted, or pinned to the wrong
# instance, looks exactly like a healthy one from the inside — this command is
# the only affordance that can tell the difference, so all three of its facts
# have to be real. `instance:` in particular: it read `unverified` for every
# dashboard-spawned session until the id was sourced from the socket's sibling
# `instances/<piPort>.id`, which made the command useless precisely where it
# was needed.
#
# OBSERVING IT. The handler writes with `console.error`, and pi's output goes
# to /dev/null unless `keeperLog.capturePiOutput` is on — so the arm turns that
# on and reads `keeper-<transport>.log`. That is not a test convenience: it is
# the same switch an operator has to find, and if the output stops landing
# there the command is unreadable in the field too.
#
# Needs a real `pi` (the command is registered by the bridge extension inside
# a live session), so it SKIPS rather than fails when pi is absent.
#
# See change: add-pi-gateway-transport-identity (test-plan #F7 → task 12.43).
set -euo pipefail

echo "=== Test: /dashboard-where reports endpoint, instance, pinned (F7) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"; exit 0
fi
if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH — the command is registered inside a live session"; exit 0
fi

PORT=18830
GATEWAY=19830
QA_HOME=""
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT"; exit 1
fi

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-where-XXXXXX")"
mkdir -p "$QA_HOME/.pi/dashboard" "$QA_HOME/work"
printf '{"keeperLog":{"capturePiOutput":true}}' > "$QA_HOME/.pi/dashboard/config.json"

HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
[ "$WAITED" -lt 90 ] || { echo "FAIL: dashboard never started"; sed -n '1,40p' "$QA_HOME/start.log"; exit 1; }

health_field() {
  curl -s --max-time 5 "http://localhost:$PORT/api/health" 2>/dev/null |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)['$1']??''))}catch{process.stdout.write('')}})"
}
SRV_PID="$(health_field pid)"
INSTANCE_ID="$(health_field instanceId)"
[ -n "$INSTANCE_ID" ] || { echo "FAIL: the dashboard published no instanceId"; exit 1; }

curl -s -X POST "http://localhost:$PORT/api/session/spawn" \
  -H 'Content-Type: application/json' -d "{\"cwd\":\"$QA_HOME/work\"}" -o "$QA_HOME/spawn.json" > /dev/null
grep -q '"success":true' "$QA_HOME/spawn.json" || {
  echo "FAIL: session spawn refused"; cat "$QA_HOME/spawn.json"; exit 1
}

# The session registers only once pi has booted and the bridge has dialled.
SESSION_ID=""
WAITED=0
while [ "$WAITED" -lt 120 ]; do
  SESSION_ID="$(curl -s --max-time 5 "http://localhost:$PORT/api/sessions" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s).data??[];process.stdout.write(String(d[0]?.id??''))}catch{process.stdout.write('')}})")"
  [ -n "$SESSION_ID" ] && break
  sleep 3; WAITED=$((WAITED + 3))
done
[ -n "$SESSION_ID" ] || { echo "FAIL: the spawned pi session never registered"; exit 1; }

curl -s -X POST "http://localhost:$PORT/api/session/$SESSION_ID/prompt" \
  -H 'Content-Type: application/json' -d '{"text":"/dashboard-where"}' -o "$QA_HOME/prompt.json" > /dev/null
grep -q '"success":true' "$QA_HOME/prompt.json" || {
  echo "FAIL: the command was not transmitted"; cat "$QA_HOME/prompt.json"; exit 1
}

# The output rides pi's stderr into the keeper log; give the dispatch a moment.
WHERE=""
WAITED=0
while [ "$WAITED" -lt 30 ]; do
  WHERE="$(grep -h -A3 '^\[dashboard\] where:' "$QA_HOME/.pi/dashboard/sessions/keeper-"*.log 2>/dev/null || true)"
  [ -n "$WHERE" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
if [ -z "$WHERE" ]; then
  echo "FAIL: /dashboard-where produced no output in the keeper log"
  echo "      (either the command did not dispatch, or its output is no longer readable)"
  exit 1
fi
echo "$WHERE" | sed 's/^/    /'

# 1 — endpoint. The dashboard is socket-by-default, so this session must be on
#     THIS instance's socket, named in full.
if ! printf '%s' "$WHERE" | grep -q "endpoint:.*gateway-$GATEWAY\.sock"; then
  echo "FAIL: 'endpoint' does not name this instance's gateway socket"
  exit 1
fi

# 2 — instance. The whole point of the field: it must be the id /api/health
#     publishes, not a placeholder.
if printf '%s' "$WHERE" | grep -q "instance:[[:space:]]*unverified"; then
  echo "FAIL: 'instance' reads 'unverified' for a locally-pinned session"
  echo "      the id is on disk beside the socket (instances/$GATEWAY.id) — it should be reported"
  exit 1
fi
if ! printf '%s' "$WHERE" | grep -q "instance:[[:space:]]*$INSTANCE_ID"; then
  echo "FAIL: 'instance' does not match /api/health.instanceId ($INSTANCE_ID)"
  exit 1
fi

# 3 — pinned. A dashboard-spawned session is pinned via PI_DASHBOARD_SOCKET,
#     so it must say so; reporting "no" here would mean the session believes
#     it is free to be re-targeted by discovery.
if ! printf '%s' "$WHERE" | grep -qi "pinned:[[:space:]]*yes"; then
  echo "FAIL: a socket-pinned session does not report itself as pinned"
  exit 1
fi

echo "PASS: /dashboard-where reports endpoint, instance id and pinned state"
