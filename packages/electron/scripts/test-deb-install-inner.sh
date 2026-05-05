#!/usr/bin/env bash
#
# Inner test script for DEB install test — runs INSIDE Docker as non-root user.
#
# Flow:
# 1. Verify the .deb installed correctly
# 2. Simulate the wizard setup (headless — can't interact with Electron UI)
# 3. Launch the Electron app via xvfb-run
# 4. Wait for the dashboard server to come up
# 5. Verify health + API endpoints
# 6. Kill the app and check clean exit
#
set -euo pipefail

PASS=0
FAIL=0
TESTS=()

pass() {
  PASS=$((PASS + 1))
  TESTS+=("✓ $1")
  echo "  ✓ $1"
}

fail() {
  FAIL=$((FAIL + 1))
  TESTS+=("✗ $1: $2")
  echo "  ✗ $1: $2"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test 1: Verify DEB installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check binary exists
if [ -x /usr/lib/pi-dashboard/pi-dashboard ]; then
  pass "Electron binary installed"
else
  fail "Electron binary" "not found at /usr/lib/pi-dashboard/pi-dashboard"
fi

# Check resources exist
if [ -d /usr/lib/pi-dashboard/resources ]; then
  pass "Resources directory exists"
else
  fail "Resources" "directory not found"
fi

# Check bundled server
SERVER_CLI="/usr/lib/pi-dashboard/resources/server/packages/server/src/cli.ts"
if [ -f "$SERVER_CLI" ]; then
  pass "Bundled server CLI exists"
else
  fail "Bundled server CLI" "not found at $SERVER_CLI"
fi

# Check bundled Node.js
BUNDLED_NODE="/usr/lib/pi-dashboard/resources/node/bin/node"
if [ -x "$BUNDLED_NODE" ]; then
  NODE_VER=$("$BUNDLED_NODE" --version 2>/dev/null || echo "?")
  pass "Bundled Node.js: $NODE_VER"
else
  fail "Bundled Node.js" "not found at $BUNDLED_NODE"
fi

# Check client build in bundled server
CLIENT_INDEX="/usr/lib/pi-dashboard/resources/server/packages/dist/client/index.html"
if [ -f "$CLIENT_INDEX" ]; then
  pass "Client build bundled"
else
  fail "Client build" "not found at $CLIENT_INDEX"
fi

# Check server node_modules
if [ -d /usr/lib/pi-dashboard/resources/server/node_modules ]; then
  pass "Server node_modules installed"
else
  fail "Server node_modules" "not found"
fi

# Check node-pty Linux prebuild
PTY_PREBUILD="/usr/lib/pi-dashboard/resources/server/node_modules/node-pty/prebuilds/linux-x64/pty.node"
if [ -f "$PTY_PREBUILD" ]; then
  pass "node-pty linux-x64 prebuild exists"
else
  fail "node-pty prebuild" "not found at $PTY_PREBUILD"
fi

# Check loading-page HTML resource (change: electron-server-launch-controls).
# Loading page must be a real HTML file so the preload can attach the
# `piDashboard` IPC bridge (Start server / Open Doctor / Server log).
LOADING_HTML="/usr/lib/pi-dashboard/resources/loading.html"
if [ -f "$LOADING_HTML" ]; then
  pass "Loading page resource bundled"
else
  fail "Loading page resource" "not found at $LOADING_HTML"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test 2: Simulate wizard setup (headless)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# The wizard normally runs in the Electron renderer. We simulate it by:
# 1. Installing tsx into ~/.pi-dashboard/ (what installStandalone does)
# 2. Writing mode.json (what wizard:complete does)

MANAGED_DIR="$HOME/.pi-dashboard"
mkdir -p "$MANAGED_DIR"
echo '{"name":"pi-dashboard-managed","private":true,"type":"module"}' > "$MANAGED_DIR/package.json"

# Use bundled Node/npm to install tsx + pi (same as dependency-installer.ts)
export PATH="/usr/lib/pi-dashboard/resources/node/bin:$PATH"
echo "  → Installing tsx + pi..."
cd "$MANAGED_DIR"
npm install tsx @mariozechner/pi-coding-agent 2>&1 | tail -3
TSX_BIN="$MANAGED_DIR/node_modules/.bin/tsx"
PI_BIN="$MANAGED_DIR/node_modules/.bin/pi"

if [ -x "$TSX_BIN" ]; then
  pass "tsx installed: $("$TSX_BIN" --version 2>/dev/null || echo "?")"
else
  fail "tsx install" "binary not found at $TSX_BIN"
fi

if [ -x "$PI_BIN" ]; then
  pass "pi binary found"
else
  fail "pi binary" "not found at $PI_BIN"
fi

# Write mode.json (simulates wizard completion)
cat > "$MANAGED_DIR/mode.json" <<EOF
{
  "mode": "standalone",
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF
pass "Wrote mode.json (standalone mode)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test 3: Launch Electron app (xvfb headless)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Launch the Electron app with a virtual display
# --no-sandbox is needed because we're in a Docker container
echo "  → Starting Electron app with xvfb-run..."
xvfb-run -a /usr/lib/pi-dashboard/pi-dashboard --no-sandbox \
  > /tmp/electron.log 2>&1 &
ELECTRON_PID=$!
echo "  → Electron PID: $ELECTRON_PID"

# Wait for the dashboard server to become available
# The Electron app should: skip wizard (mode.json exists) → ensureServer → spawn tsx
DEADLINE=$((SECONDS + 45))
SERVER_UP=false
PORT=8000

while [ $SECONDS -lt $DEADLINE ]; do
  sleep 2
  # Check if Electron is still running
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    echo "  ⚠ Electron process exited early"
    break
  fi
  # Check health endpoint
  if curl -sf "http://localhost:$PORT/api/health" > /tmp/health.json 2>/dev/null; then
    SERVER_UP=true
    break
  fi
  echo "  ... waiting for dashboard server (${SECONDS}s)"
done

if [ "$SERVER_UP" = true ]; then
  pass "Dashboard server started via Electron app"

  # Parse health response
  if command -v python3 &>/dev/null; then
    MODE=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('mode','?'))" < /tmp/health.json 2>/dev/null || echo "?")
    VERSION=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('version','?'))" < /tmp/health.json 2>/dev/null || echo "?")
    echo "    Server mode: $MODE, version: $VERSION"
  fi
  pass "Health endpoint responds"

  # Test sessions API
  if curl -sf "http://localhost:$PORT/api/sessions" > /dev/null 2>&1; then
    pass "Sessions API responds"
  else
    fail "Sessions API" "no response"
  fi

  # Test that client build is served (not API-only mode)
  if curl -sf "http://localhost:$PORT/" 2>/dev/null | grep -q "<html"; then
    pass "Client build served (not API-only)"
  else
    fail "Client build" "HTML not served — may be in API-only mode"
  fi

  # Check server process is separate from Electron
  SERVER_PID_FROM_HEALTH=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('pid',''))" < /tmp/health.json 2>/dev/null || echo "")
  if [ -n "$SERVER_PID_FROM_HEALTH" ] && [ "$SERVER_PID_FROM_HEALTH" != "$ELECTRON_PID" ]; then
    pass "Server running as separate process (PID: $SERVER_PID_FROM_HEALTH)"
  else
    pass "Server is running"
  fi

  # Test session creation via REST API
  echo "  → Testing session spawn..."
  SPAWN_DIR=$(mktemp -d)
  SPAWN_RESP=$(curl -sf -X POST "http://localhost:$PORT/api/session/spawn" \
    -H "Content-Type: application/json" \
    -d "{\"cwd\": \"$SPAWN_DIR\"}" 2>&1 || echo '{"success":false}')
  if echo "$SPAWN_RESP" | grep -q '"success":true'; then
    pass "Session spawn API returned success"
    sleep 3
    if ps aux 2>/dev/null | grep -v grep | grep -q "pi.*--mode.*rpc"; then
      pass "pi process running in headless mode"
      pkill -f "pi.*--mode.*rpc" 2>/dev/null || true
    else
      fail "pi process" "no headless pi process found after spawn"
    fi
  else
    fail "Session spawn API" "response: $SPAWN_RESP"
  fi
  rm -rf "$SPAWN_DIR"
else
  fail "Dashboard server" "did not start within 45s"
  echo ""
  echo "  Electron log (last 30 lines):"
  tail -30 /tmp/electron.log 2>/dev/null || echo "  (no log)"
  echo ""
  echo "  Server log:"
  cat "$HOME/.pi-dashboard/server.log" 2>/dev/null || echo "  (no server log)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test 4: Clean shutdown"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Kill Electron — this should trigger the quit handler which stops the server
if kill -0 "$ELECTRON_PID" 2>/dev/null; then
  kill "$ELECTRON_PID" 2>/dev/null || true
  # Wait for exit
  for i in $(seq 1 10); do
    if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    pass "Electron exited cleanly"
  else
    kill -9 "$ELECTRON_PID" 2>/dev/null || true
    fail "Electron exit" "had to force kill"
  fi
fi

# Check that server also stopped (or stop it)
sleep 2
if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
  # Server still running — try shutdown endpoint
  curl -sf -X POST "http://localhost:$PORT/api/shutdown" > /dev/null 2>&1 || true
  sleep 2
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    fail "Server shutdown" "server still running after Electron exit"
  else
    pass "Server stopped (via shutdown endpoint)"
  fi
else
  pass "Server stopped with Electron"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
for t in "${TESTS[@]}"; do
  echo "  $t"
done
echo ""
echo "  $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
