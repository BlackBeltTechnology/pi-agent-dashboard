#!/usr/bin/env bash
# Test: managed services against a REAL rootless podman on the Linux VM
# (test-plan #X11, #X12, #X13). See change: add-service-registry-core.
#
#   X11  user-authored OCI service: add -> ensure (healthy, host-reachable)
#        -> release -> server restart (adopted, no duplicate container)
#        -> idle-stop after a shortened idleStopMinutes.
#   X12  stored secret: absent from `podman inspect`, readable at
#        /run/secrets/<name> inside the container.
#   X13  native `npx` recipe: `service stop` leaves 0 processes of its group.
#
# Hermetic: throwaway $HOME + QA_PORT (default 18342), never :8000.
# Launcher: PI_DASHBOARD_CMD (default `pi-dashboard`; checkout:
# `node packages/server/bin/pi-dashboard.mjs`). SKIPs (exit 0) off Linux or
# without podman. The SCRIPT pulls/prefetches its fixtures explicitly — the
# dashboard itself never pulls an image or fetches a package implicitly.
set -euo pipefail

echo "=== Test: managed services on podman (X11-X13) ==="

if [ "$(uname -s)" != "Linux" ]; then
  echo "SKIP: Linux-only (rootless podman, no host tunnel)"
  exit 0
fi
if ! command -v podman >/dev/null 2>&1; then
  echo "SKIP: podman not installed (provision it on the qa linux image)"
  exit 0
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

QA_PORT="${QA_PORT:-18342}"
read -r -a DASH <<<"${PI_DASHBOARD_CMD:-pi-dashboard}"
REAL_HOME="$HOME"
QA_HOME="$(mktemp -d)"
IMAGE="docker.io/library/busybox:1.36"
MARKER="SVCTEST-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

svc() { HOME="$QA_HOME" "${DASH[@]}" service "$@" --port "$QA_PORT"; }
start_server() {
  HOME="$QA_HOME" NVM_DIR="$NVM_DIR" "${DASH[@]}" start --port "$QA_PORT" >/dev/null 2>&1 &
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$QA_PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FAIL: dashboard did not come up on :$QA_PORT"
  exit 1
}
stop_server() { HOME="$QA_HOME" "${DASH[@]}" stop --port "$QA_PORT" >/dev/null 2>&1 || true; sleep 2; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=($1);process.stdout.write(v===undefined?'':String(v))})"; }
containers() { podman ps -a -q --filter "label=pi.service=$1" | wc -l | tr -d ' '; }

cleanup() {
  svc remove --all --purge-data --json >/dev/null 2>&1 || true
  stop_server
  podman ps -a -q --filter label=pi.service | xargs -r podman rm -f >/dev/null 2>&1 || true
  rm -rf "$QA_HOME"
}
trap cleanup EXIT

# Fixture image: pulled by the TEST, never by the dashboard.
podman pull -q "$IMAGE" >/dev/null

mkdir -p "$QA_HOME/.pi/dashboard"
cat >"$QA_HOME/web.json" <<EOF
{
  "id": "web",
  "mode": "managed",
  "drivers": ["oci:podman"],
  "oci": {
    "image": "$IMAGE",
    "ports": { "http": { "container": 8080, "protocol": "http" } },
    "command": ["sh", "-c", "mkdir -p /www && echo ok > /www/index.html && exec httpd -f -p 8080 -h /www"]
  },
  "health": { "kind": "http", "endpoint": "http", "path": "/" },
  "secrets": { "pw": {} },
  "idleStopMinutes": 0.05
}
EOF

start_server

# ── X11 ─────────────────────────────────────────────────────────────────────
svc add --file "$QA_HOME/web.json" --yes --json >/dev/null
printf '%s' "$MARKER" | svc secret set web pw --json >/dev/null
P=$(svc ensure web --json)
STATE=$(printf '%s' "$P" | json 'j.state')
URL=$(printf '%s' "$P" | json 'j.endpoints && j.endpoints.http')
LEASE=$(printf '%s' "$P" | json 'j.leaseId')
if [ "$STATE" != "healthy" ]; then echo "FAIL (#X11): ensure -> $P"; exit 1; fi
curl -fsS "$URL/" | grep -q ok || { echo "FAIL (#X11): $URL not reachable from the host"; exit 1; }
echo "#X11: healthy and host-reachable at $URL"

# ── X12 (same instance) ─────────────────────────────────────────────────────
CID=$(podman ps -q --filter label=pi.service=web)
if podman inspect "$CID" | grep -qF "$MARKER"; then echo "FAIL (#X12): secret value in podman inspect"; exit 1; fi
if [ "$(podman exec "$CID" cat /run/secrets/pw)" != "$MARKER" ]; then echo "FAIL (#X12): /run/secrets/pw does not hold the secret"; exit 1; fi
if svc status web --json | grep -qF "$MARKER"; then echo "FAIL (#X12): status carries the secret"; exit 1; fi
echo "#X12: secret absent from inspect/status, readable at /run/secrets/pw"

svc release web "$LEASE" --json >/dev/null
stop_server
start_server
P2=$(svc ensure web --json)
if [ "$(printf '%s' "$P2" | json 'j.state')" != "healthy" ]; then echo "FAIL (#X11): ensure after restart -> $P2"; exit 1; fi
if [ "$(containers web)" != "1" ]; then echo "FAIL (#X11): $(containers web) containers after restart (duplicate?)"; exit 1; fi
svc release web "$(printf '%s' "$P2" | json 'j.leaseId')" --json >/dev/null
echo "#X11: adopted after restart, one container"
STOPPED=0
for _ in $(seq 1 90); do
  if [ -z "$(podman ps -q --filter label=pi.service=web)" ]; then STOPPED=1; break; fi
  sleep 1
done
if [ "$STOPPED" != "1" ]; then echo "FAIL (#X11): not idle-stopped within 90 s"; exit 1; fi
if [ "$(containers web)" != "1" ]; then echo "FAIL (#X11): stopped container was not retained"; exit 1; fi
echo "#X11: idle-stopped, container retained"

# ── X13 ─────────────────────────────────────────────────────────────────────
cat >"$QA_HOME/static.json" <<'EOF'
{
  "id": "static",
  "mode": "managed",
  "drivers": ["native"],
  "native": {
    "runner": "npx",
    "package": "http-server@14.1.1",
    "args": ["-p", "${port.http}", "-a", "127.0.0.1", "--silent"],
    "ports": { "http": { "protocol": "http" } }
  },
  "health": { "kind": "http", "endpoint": "http", "path": "/" }
}
EOF
svc add --file "$QA_HOME/static.json" --yes --json >/dev/null
ABSENT=$(svc ensure static --json)
if [ "$(printf '%s' "$ABSENT" | json 'j.reason')" != "package-absent" ]; then echo "FAIL (#X13): expected package-absent before prefetch, got $ABSENT"; exit 1; fi
svc prefetch static --yes --json >/dev/null
P3=$(svc ensure static --json)
if [ "$(printf '%s' "$P3" | json 'j.state')" != "healthy" ]; then echo "FAIL (#X13): ensure -> $P3"; exit 1; fi
PGID=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$QA_HOME/.pi/dashboard/services-run/static/instance.json','utf8')).pid))")
pgrep -g "$PGID" >/dev/null || { echo "FAIL (#X13): no process in group $PGID while healthy"; exit 1; }
svc stop static --json >/dev/null
sleep 1
if pgrep -g "$PGID" >/dev/null; then
  echo "FAIL (#X13): processes left in group $PGID:"; pgrep -a -g "$PGID"; exit 1
fi
echo "#X13: stop left 0 processes of group $PGID"

HOME="$REAL_HOME"
echo "PASS"
