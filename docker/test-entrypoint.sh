#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# pi-dashboard TEST entrypoint — wraps the base entrypoint with:
#   1. A path-parity overlay so ${HOST_CWD} is writable inside the container
#      while host files stay untouched (writes land in a throwaway tmpfs).
#   2. A fail-fast smoke check (HTTP /api/health + one WS connect) that exits
#      non-zero before a human is directed to a browser.
#
# TEST_COPY_MODE=1 swaps the overlay for a plain `cp -a` onto a tmpfs — no
# CAP_SYS_ADMIN needed (for locked-down hosts). Slower, RAM-heavy on big trees.
#
# See openspec change docker-test-harness, design.md (Decisions 3 + 4).
# ---------------------------------------------------------------------------
set -euo pipefail

LOWER="/mnt/test-lower"
# upper + work MUST share one filesystem (overlayfs requirement) — both live
# under the single /mnt/test-overlay tmpfs declared in compose.test.yml.
UPPER="/mnt/test-overlay/upper"
WORK="/mnt/test-overlay/work"

# --- 1. Path-parity mount --------------------------------------------------
if [ -n "${HOST_CWD:-}" ]; then
  mkdir -p "${HOST_CWD}"
  if [ "${TEST_COPY_MODE:-}" = "1" ]; then
    # Copy-mode fallback: no overlay, no capability. ${HOST_CWD} is a tmpfs
    # (declared in compose.test.yml) so the copy never touches the host.
    echo "[test-entrypoint] TEST_COPY_MODE=1 → cp -a ${LOWER}/. ${HOST_CWD}"
    # Fail fast: a failed workspace copy means the QA run can't proceed.
    cp -a "${LOWER}/." "${HOST_CWD}/"
  else
    echo "[test-entrypoint] overlay ${LOWER} (ro) + tmpfs upper → ${HOST_CWD}"
    mkdir -p "${UPPER}" "${WORK}"
    mount -t overlay overlay \
      -o "lowerdir=${LOWER},upperdir=${UPPER},workdir=${WORK}" \
      "${HOST_CWD}"
  fi
else
  echo "[test-entrypoint] HOST_CWD unset → no path-parity mount (fixtures only)"
fi

# --- 1b. Materialize VCS fixtures as real repos (ephemeral tmpfs) ----------
if [ -d /fixtures-src ] && [ -d /fixtures ]; then
  cp -a /fixtures-src/. /fixtures/ 2>/dev/null || true
  export GIT_AUTHOR_NAME="pi-test" GIT_AUTHOR_EMAIL="pi-test@localhost"
  export GIT_COMMITTER_NAME="pi-test" GIT_COMMITTER_EMAIL="pi-test@localhost"
  if [ -d /fixtures/sample-git ] && ! [ -d /fixtures/sample-git/.git ]; then
    ( cd /fixtures/sample-git \
      && git init -q \
      && git add -A \
      && git commit -q -m "initial fixture commit" ) \
      && echo "[test-entrypoint] git fixture ready: /fixtures/sample-git"
  fi
  if [ -d /fixtures/sample-jj ] && ! [ -d /fixtures/sample-jj/.jj ]; then
    ( cd /fixtures/sample-jj && jj git init >/dev/null 2>&1 ) \
      && echo "[test-entrypoint] jj fixture ready: /fixtures/sample-jj"
  fi
fi

# --- 2. Launch the dashboard daemon via the base entrypoint ----------------
# The base entrypoint seeds auth/config, starts tmux, then runs
# `pi-dashboard start` — which spawns a DETACHED server daemon (pidfile below)
# and returns once it polls healthy. We keep PID 1 alive afterward (step 4).
PORT="${DASHBOARD_PORT:-18000}"
PIDFILE="${HOME:-/home/pi}/.pi/dashboard/server.pid"
echo "[test-entrypoint] launching dashboard daemon via base entrypoint..."
# The base launcher waits up to 30s for readiness then exits non-zero, but the
# server is spawned DETACHED (unref'd) and SURVIVES that timeout — cold-start
# via the jiti TS loader can exceed 30s on a loaded host. Tolerate a non-zero
# return; our own health poll below is the authority on readiness.
/usr/local/bin/entrypoint.sh "$@" \
  || echo "[test-entrypoint] base launcher exited non-zero (likely readiness timeout); daemon is detached, polling health..."

# --- 3. Fail-fast smoke check ----------------------------------------------
smoke_fail() {
  echo "[test-entrypoint] SMOKE FAILED: $1" >&2
  [ -f "${PIDFILE}" ] && kill -TERM "$(cat "${PIDFILE}")" 2>/dev/null || true
  exit 1
}

# Confirm HTTP /api/health. Poll generously — a slow jiti cold-start may still
# be initializing after the base launcher's 30s window elapsed.
healthy=0
for _ in $(seq 1 90); do
  if curl --connect-timeout 1 --max-time 2 -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
[ "${healthy}" = "1" ] || smoke_fail "GET /api/health did not return 200 within ~90s"
echo "[test-entrypoint] health OK"

# One WebSocket connect to /ws (Node 22 ships a global WebSocket client).
node -e '
  const url = process.argv[1];
  const ws = new WebSocket(url);
  const t = setTimeout(() => { console.error("ws connect timeout"); process.exit(1); }, 5000);
  ws.onopen = () => { clearTimeout(t); ws.close(); process.exit(0); };
  ws.onerror = (e) => { clearTimeout(t); console.error("ws error", (e && e.message) || e); process.exit(1); };
' "ws://localhost:${PORT}/ws" || smoke_fail "WebSocket connect to /ws failed"
echo "[test-entrypoint] websocket OK"

echo "[test-entrypoint] SMOKE PASSED → dashboard ready on http://localhost:${PORT}"

# --- 4. Keep PID 1 alive for the daemon's lifetime -------------------------
SERVER_PID="$(cat "${PIDFILE}" 2>/dev/null || true)"
[ -n "${SERVER_PID}" ] || smoke_fail "server.pid not found at ${PIDFILE}"
trap 'kill -TERM "${SERVER_PID}" 2>/dev/null || true' TERM INT
while kill -0 "${SERVER_PID}" 2>/dev/null; do
  sleep 5
done
echo "[test-entrypoint] dashboard daemon (pid ${SERVER_PID}) exited"
