#!/bin/bash
set -e

RICH_MODE=0
if [ "$1" = "--rich" ]; then
  RICH_MODE=1
  shift
fi

export PATH="/home/pi/.pi-dashboard/node_modules/.bin:/usr/local/bin:$PATH"

echo "[sandbox] ========================================"
echo "[sandbox] Starting sandbox with full pi + dashboard"
echo "[sandbox] ========================================"

# Copy seed data
cp -r /home/pi/.pi/agent/sessions-seed/* /home/pi/.pi/agent/sessions/ 2>/dev/null || true

# ── Git repo + worktrees ────────────────────────────────────────────
PROJECT_DIR="/home/pi/dev/my-project"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
if [ ! -d .git ]; then
  git init
  git config user.email "dev@example.com"
  git config user.name "Dev"
  echo "// Project source code" > README.md
  echo "export function hello() { return 'hello'; }" > index.ts
  git add .
  git commit -m "initial commit"
  git checkout -b feature/refactor-api-client
  echo "// refactored" >> index.ts
  git add . && git commit -m "wip: refactor api client"
  git checkout -b feature/dark-mode main 2>/dev/null || git checkout -b feature/dark-mode
  echo "// dark mode utils" > theme.ts
  git add . && git commit -m "wip: dark mode"
fi

WORKTREE_DIR="/home/pi/dev/worktrees"
mkdir -p "$WORKTREE_DIR"
git worktree add "$WORKTREE_DIR/shadow-refactor" -b shadow/refactor-api feature/refactor-api-client 2>/dev/null || true
git worktree add "$WORKTREE_DIR/shadow-darkmode" -b shadow/dark-mode feature/dark-mode 2>/dev/null || true

# ── Second project (no git) ───────────────────────────────────────
PROJECT2="/home/pi/dev/other-project"
mkdir -p "$PROJECT2"
cd "$PROJECT2"
if [ ! -d .git ]; then
  git init && git config user.email "dev@example.com" && git config user.name "Dev"
  echo "// Other project" > lib.ts && git add . && git commit -m "init"
fi

echo "[sandbox] Git repos + worktrees ready"

# ── Dashboard server ────────────────────────────────────────────────
cd /app
echo "[sandbox] Starting dashboard server..."
node --import tsx packages/server/src/cli.ts --dev &
DASHBOARD_PID=$!

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

# ── Headless Chromium for screenshot capture ─────────────────────────
echo "[sandbox] Starting headless Chromium on port 9222..."
chromium --headless --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 &
CHROME_PID=$!
sleep 2
echo "[sandbox] Chromium ready (PID $CHROME_PID)"

# ── Wait for bootstrap ──────────────────────────────────────────────
echo "[sandbox] Waiting for pi bootstrap..."
for i in $(seq 1 30); do
  STATUS=$(curl -sf http://localhost:8000/api/bootstrap/status 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ready" ]; then
    echo "[sandbox] Bootstrap ready"
    break
  fi
  sleep 2
done

# ── Bridge seed script: send fake bridge events via WebSocket ────────
echo "[sandbox] Seeding bridge events..."
node /app/sandbox/seed-bridge.mjs &
SEED_PID=$!
sleep 3

# ── Rich mode: seed sessions via bridge ───────────────────────────
if [ "$RICH_MODE" = "1" ]; then
  echo "[sandbox] Rich mode: seeding sessions..."
  node /app/sandbox/seed-bridge.mjs &
  sleep 5
fi

echo "[sandbox] Sandbox ready. Dashboard: http://localhost:8000"
wait $DASHBOARD_PID
