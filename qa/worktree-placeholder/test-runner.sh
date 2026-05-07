#!/usr/bin/env bash
set -euo pipefail

export HOME=/tmp/pi-dashboard-home
export PI_DASHBOARD_PORT=${PI_DASHBOARD_PORT:-18080}
export PI_DASHBOARD_PI_PORT=${PI_DASHBOARD_PI_PORT:-19999}
export PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

mkdir -p "$HOME/.pi/dashboard"
cat > "$HOME/.pi/dashboard/config.json" <<'JSONEOF'
{
  "port": 18080,
  "piPort": 19999,
  "spawnStrategy": "headless",
  "tunnel": { "enabled": false },
  "auth": { "enabled": false }
}
JSONEOF

fuser -k "$PI_DASHBOARD_PI_PORT/tcp" 2>/dev/null || true
fuser -k "$PI_DASHBOARD_PORT/tcp" 2>/dev/null || true
sleep 0.5

echo "[test-runner] Starting dashboard server on port $PI_DASHBOARD_PORT..."
SERVER_LOG=/tmp/pi-dashboard-server.log

cd /app
npx tsx packages/server/src/cli.ts \
  --port "$PI_DASHBOARD_PORT" \
  --pi-port "$PI_DASHBOARD_PI_PORT" \
  --no-tunnel \
  >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  set +e
  echo "[test-runner] Shutting down server (pid $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  echo "--- dashboard server log (last 100 lines) ---"
  tail -100 "$SERVER_LOG" || true
}
trap cleanup EXIT

echo "[test-runner] Waiting for server to become healthy..."
for i in $(seq 1 300); do
  if curl -fsS "http://127.0.0.1:$PI_DASHBOARD_PORT/api/health" >/dev/null 2>&1; then
    echo "[test-runner] Server is healthy (attempt $i)"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[test-runner] ERROR: dashboard server exited early" >&2
    tail -50 "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 0.2
  if [[ "$i" == "300" ]]; then
    echo "[test-runner] ERROR: dashboard server did not become healthy" >&2
    tail -50 "$SERVER_LOG" >&2
    exit 1
  fi
done

echo "[test-runner] Running worktree placeholder tests..."
node qa/worktree-placeholder/worktree-placeholder.test.mjs
echo "[test-runner] All tests passed!"
