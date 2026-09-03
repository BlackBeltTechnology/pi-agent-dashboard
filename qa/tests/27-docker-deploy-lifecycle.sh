#!/usr/bin/env bash
# Test: the DOCUMENTED docker deployment actually stays up, on a clean machine.
#
# Both failures this arm exists for were shipped and invisible, because the E2E
# harness overrides the two things that break:
#
#   `compose.test.yml` runs `user: "root"`, hiding that a fresh `pi-state`
#   volume is root-owned while the container runs as `pi`;
#   `test-entrypoint.sh` supervises the daemon itself, hiding that the base
#   entrypoint's `pi-dashboard start` detaches and lets PID 1 exit.
#
# So the harness was green over a deployment that could not boot, and then
# could not stay booted. This arm runs `docker compose up -d` exactly as
# `docker/README.md` documents it — no test entrypoint, no root, fresh volumes.
#
# It also carries the socket half of task 8.7: the gateway socket must live on
# the VOLUME mount and be owned by the user that runs, since that mount is the
# whole reason to doubt it.
#
# Slow (an image build plus a settle window) and needs docker, so it is OPT-IN
# and not in run-all.sh. `PI_QA_DOCKER=1` to run it.
#
# See change: add-pi-gateway-transport-identity (task 8.7).
set -euo pipefail

echo "=== Test: docker compose deployment boots, stays up, and serves the socket ==="

if [ "${PI_QA_DOCKER:-}" != "1" ]; then
  echo "SKIP: opt-in (PI_QA_DOCKER=1) — builds an image and waits out a settle window"; exit 0
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not on PATH"; exit 0
fi
if ! docker info >/dev/null 2>&1; then
  echo "SKIP: docker daemon not reachable"; exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="qa-deploy-$$"
PORT="${PI_QA_DOCKER_PORT:-18881}"
GATEWAY="${PI_QA_DOCKER_GATEWAY_PORT:-19881}"
SETTLE="${PI_QA_DOCKER_SETTLE:-120}"

cleanup() {
  ( cd "$REPO_ROOT/docker" && docker compose -p "$PROJECT" down -v >/dev/null 2>&1 ) || true
}
trap cleanup EXIT

cd "$REPO_ROOT/docker"
[ -f .env ] || cp .env.example .env

echo "--- building the image (this is the deployment path, not a test image)"
if ! docker compose -f compose.yml build > /tmp/qa-docker-build.log 2>&1; then
  echo "FAIL: the documented image build failed"; tail -20 /tmp/qa-docker-build.log; exit 1
fi

# Fresh project name AND `down -v` first: a volume left by an earlier run would
# already be chowned, which is exactly the state that hides the bug.
docker compose -p "$PROJECT" down -v >/dev/null 2>&1 || true

echo "--- docker compose up -d (fresh volumes)"
DASHBOARD_PORT="$PORT" PI_GATEWAY_PORT="$GATEWAY" TUNNEL_ENABLED=0 \
  docker compose -p "$PROJECT" up -d > /tmp/qa-docker-up.log 2>&1 || {
    echo "FAIL: compose up failed"; cat /tmp/qa-docker-up.log; exit 1
  }

CONTAINER="$(docker compose -p "$PROJECT" ps -q pi-dashboard 2>/dev/null | head -1)"
[ -n "$CONTAINER" ] || { echo "FAIL: no container was created"; exit 1; }

echo "--- waiting for /api/health"
HEALTHY=0
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
    HEALTHY=1; break
  fi
  sleep 3
done
if [ "$HEALTHY" != "1" ]; then
  # Name the likely cause rather than just the symptom: a container that keeps
  # restarting is unreachable for a different reason than one that is up and
  # broken, and the restart count is the cheapest way to tell.
  RESTARTS="$(docker inspect "$CONTAINER" --format '{{.RestartCount}}' 2>/dev/null || echo '?')"
  echo "FAIL: the dashboard never answered on port $PORT (container restarts: $RESTARTS)"
  [ "$RESTARTS" = "0" ] || echo "      PID 1 is exiting — the entrypoint is not supervising the daemon"
  docker compose -p "$PROJECT" logs 2>&1 | tail -25
  exit 1
fi
echo "    healthy"

# ── The container must STAY up ────────────────────────────────────────────
# A detaching PID 1 exits 0 and `restart: unless-stopped` brings the container
# straight back, so a snapshot of "is it running" says yes at almost any
# instant. The restart COUNT is what tells them apart.
BEFORE="$(docker inspect "$CONTAINER" --format '{{.RestartCount}}')"
echo "--- holding for ${SETTLE}s to see whether PID 1 survives (restarts so far: $BEFORE)"
sleep "$SETTLE"
AFTER="$(docker inspect "$CONTAINER" --format '{{.RestartCount}}')"
STATE="$(docker inspect "$CONTAINER" --format '{{.State.Status}}')"

if [ "$AFTER" != "0" ]; then
  echo "FAIL: the container restarted $AFTER time(s) in ${SETTLE}s — PID 1 is not staying alive"
  echo "      (a daemonizing entrypoint exits 0 the moment the server detaches)"
  docker compose -p "$PROJECT" logs 2>&1 | tail -15
  exit 1
fi
if [ "$STATE" != "running" ]; then
  echo "FAIL: container state is '$STATE' after ${SETTLE}s, expected 'running'"; exit 1
fi
echo "    no restarts in ${SETTLE}s"

# ── The gateway socket, on the VOLUME mount (task 8.7) ────────────────────
SOCK_LS="$(docker exec "$CONTAINER" sh -c "ls -la /home/pi/.pi/dashboard/gateway-$GATEWAY.sock" 2>&1 || true)"
case "$SOCK_LS" in
  s*) : ;;
  *) echo "FAIL: no gateway socket under the VOLUME mount: $SOCK_LS"; exit 1 ;;
esac
case "$SOCK_LS" in
  *" pi pi "*) : ;;
  *) echo "FAIL: the socket is not owned by the user the container runs as: $SOCK_LS"; exit 1 ;;
esac
echo "    socket: $SOCK_LS"

# ── A bridge can DIAL the socket on this mount (task 8.7) ────────────────
# Not `/api/session/spawn`: a real pi needs provider credentials the documented
# deployment does not ship with, so that path proves nothing about the socket.
# A WebSocket client inside the container over `ws+unix://` isolates the one
# question this task asks — can a bridge reach the gateway through the VOLUME.
docker exec "$CONTAINER" node -e "
const WebSocket = require('/app/node_modules/ws');
const sock = '/home/pi/.pi/dashboard/gateway-$GATEWAY.sock';
const ws = new WebSocket('ws+unix://' + sock + ':/');
const id = '00000000-0000-4000-8000-0000000087a7';
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'session_register', sessionId: id, cwd: '/home/pi', name: 'qa-8-7', kind: 'tui' }));
  setTimeout(() => { console.log('registered'); process.exit(0); }, 3000);
});
ws.on('error', (e) => { console.error('DIAL FAILED: ' + e.message); process.exit(1); });
" > /tmp/qa-docker-dial.log 2>&1 || {
  echo "FAIL: a bridge could not dial the gateway socket on the VOLUME mount"
  cat /tmp/qa-docker-dial.log
  exit 1
}

docker exec "$CONTAINER" sh -c "curl -s http://localhost:$PORT/api/sessions" > /tmp/qa-docker-sess.json 2>&1 || true
if ! node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/qa-docker-sess.json","utf8"));process.exit((d.data||[]).some(s=>s.name==="qa-8-7")?0:1)' 2>/dev/null; then
  echo "FAIL: the socket accepted the connection but the session never registered"
  head -c 400 /tmp/qa-docker-sess.json
  exit 1
fi

# The point of the socket: a peer that arrived through it is LOCAL. One that
# came over the loopback TCP listener would carry an originDeviceId.
if ! node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/qa-docker-sess.json","utf8"));const s=(d.data||[]).find(x=>x.name==="qa-8-7");process.exit(s && !s.originDeviceId?0:1)' 2>/dev/null; then
  echo "FAIL: the session registered over the socket carries an originDeviceId"
  exit 1
fi
echo "    a bridge dialled the socket and registered as a local session"

echo "PASS: the documented deployment boots, stays up, and serves sessions over the VOLUME-mounted socket"
