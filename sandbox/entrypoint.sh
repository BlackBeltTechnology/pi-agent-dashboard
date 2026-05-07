#!/bin/bash
set -e

echo "[sandbox] Starting pi-dashboard in dev mode..."

# Copy seed data to writable location (scanner writes .meta.json cache)
cp -r /home/pi/.pi/agent/sessions-seed/* /home/pi/.pi/agent/sessions/

# Start pi-dashboard in the background
cd /app
node --import tsx packages/server/src/cli.ts --dev &
DASHBOARD_PID=$!

echo "[sandbox] Dashboard PID: $DASHBOARD_PID"

# Poll /api/health until 200 (max 30s)
MAX_WAIT=30
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "[sandbox] Dashboard healthy after ${ELAPSED}s"
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "[sandbox] ERROR: Dashboard failed to become healthy within ${MAX_WAIT}s"
  exit 1
fi

echo "[sandbox] Sandbox ready. Tailing logs..."
# Keep container alive by waiting on the dashboard process
wait $DASHBOARD_PID
