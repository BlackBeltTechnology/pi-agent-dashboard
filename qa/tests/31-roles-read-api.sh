#!/usr/bin/env bash
# Test: GET /api/roles is reachable with ZERO pi sessions connected (X8).
#
# The whole point of the roles read API is that a second frontend can read the
# role schema without holding a live pi session — the roles-plugin server entry
# mounts the route on the shared Fastify instance during plugin registration,
# before the server listens. So a freshly started dashboard with no session
# must already answer 200 with a non-empty `data` array (the built-in role
# names, unassigned). If the plugin server entry did not load, this is a 404.
#
# Needs `pi-dashboard` on PATH; SKIPS when absent.
#
# See change: add-roles-read-api (test-plan #X8 → task 9.1).
set -euo pipefail

echo "=== Test: GET /api/roles answerable session-less (X8) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"; exit 0
fi

PORT=18860
GATEWAY=19860
QA_HOME=""
SRV_PID=""

cleanup() {
  # Stop the detached daemon by pidfile+port (HOME-scoped); SRV_PID only covers
  # the launch shell, which `pi-dashboard start` may outlive.
  [ -n "$QA_HOME" ] && HOME="$QA_HOME" pi-dashboard stop >/dev/null 2>&1 || true
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT"; exit 1
fi

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-roles-XXXXXX")"
mkdir -p "$QA_HOME/.pi/dashboard"

HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &
SRV_PID=$!

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
[ "$WAITED" -lt 90 ] || { echo "FAIL: dashboard never started"; sed -n '1,40p' "$QA_HOME/start.log"; exit 1; }

# No session is spawned — this is the session-less path on purpose.
STATUS="$(curl -s -o "$QA_HOME/roles.json" -w '%{http_code}' --max-time 5 "http://localhost:$PORT/api/roles" 2>/dev/null || true)"
if [ "$STATUS" != "200" ]; then
  echo "FAIL: GET /api/roles returned $STATUS (expected 200 — is the roles-plugin server entry loaded?)"
  head -c 400 "$QA_HOME/roles.json" 2>/dev/null || true
  exit 1
fi

COUNT="$(node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const b=JSON.parse(s);process.stdout.write(String(Array.isArray(b.data)?b.data.length:0))}catch{process.stdout.write('0')}})" < "$QA_HOME/roles.json")"
if [ "$COUNT" -lt 1 ]; then
  echo "FAIL: /api/roles returned an empty data array"
  head -c 400 "$QA_HOME/roles.json"
  exit 1
fi

echo "PASS: /api/roles answered 200 with $COUNT role group(s), no session connected"
