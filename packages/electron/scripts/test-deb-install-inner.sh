#!/usr/bin/env bash
#
# Inner test script for DEB install test — runs INSIDE Docker as non-root user.
#
# Flow:
# 1. Verify the .deb installed correctly (binary, resources, bundled node,
#    bundled pi-coding-agent, loading page, manual-launch helper).
# 2. Verify pi-coding-agent version satisfies piCompatibility.minimum.
# 3. Launch the Electron app via xvfb-run.
# 4. Wait for the dashboard server to come up.
# 5. Verify health + sessions API + session spawn.
# 6. Kill the app and check clean exit.
#
# Rewrite scope: this script previously simulated a wizard runtime-install
# (npm install tsx + @mariozechner/pi-coding-agent into ~/.pi-dashboard/).
# That flow was deleted under change `eliminate-electron-runtime-install` —
# the .deb now ships pi/openspec/tsx pre-installed in the bundle. The
# wizard-simulation stage is gone; everything else is identical.
#
# See change: bump-pi-compat-to-0-78 (rewrite for bundle-only flow).
#
set -euo pipefail

PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS + 1)); TESTS+=("✓ $1"); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); TESTS+=("✗ $1: $2"); echo "  ✗ $1: $2"; }
hr()   { echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

DEB_ROOT="/usr/lib/pi-dashboard"
RESOURCES="$DEB_ROOT/resources"
SERVER_BUNDLE="$RESOURCES/server"
BUNDLED_NODE="$RESOURCES/node/bin/node"
SERVER_CLI="$SERVER_BUNDLE/packages/server/src/cli.ts"
START_SH="$SERVER_BUNDLE/start-server.sh"
PI_PKG_JSON="$SERVER_BUNDLE/node_modules/@earendil-works/pi-coding-agent/package.json"
SERVER_PKG_JSON="$SERVER_BUNDLE/node_modules/@blackbelt-technology/pi-dashboard-server/package.json"

hr; echo "  Test 1: Verify DEB installation"; hr

[ -x "$DEB_ROOT/pi-dashboard" ]                       && pass "Electron binary installed"           || fail "Electron binary" "not found at $DEB_ROOT/pi-dashboard"
[ -d "$RESOURCES" ]                                   && pass "Resources directory exists"          || fail "Resources" "directory not found"
[ -f "$SERVER_CLI" ]                                  && pass "Bundled server CLI exists"           || fail "Bundled server CLI" "not found at $SERVER_CLI"
[ -x "$BUNDLED_NODE" ] && pass "Bundled Node.js: $($BUNDLED_NODE --version 2>/dev/null || echo "?")" || fail "Bundled Node.js" "not found at $BUNDLED_NODE"
[ -f "$RESOURCES/server/packages/dist/client/index.html" ] && pass "Client build bundled"           || fail "Client build" "not found"
[ -d "$SERVER_BUNDLE/node_modules" ]                  && pass "Server node_modules installed"       || fail "Server node_modules" "not found"
[ -f "$PI_PKG_JSON" ]                                 && pass "Bundled pi-coding-agent present"     || fail "pi-coding-agent" "missing $PI_PKG_JSON"
[ -x "$START_SH" ]                                    && pass "Manual launch helper present"        || fail "start-server.sh" "missing"
[ -f "$RESOURCES/loading.html" ]                      && pass "Loading page resource bundled"       || fail "Loading page resource" "not found"

# Check node-pty Linux prebuild
PTY_PREBUILD="$SERVER_BUNDLE/node_modules/node-pty/prebuilds/linux-x64/pty.node"
[ -f "$PTY_PREBUILD" ] && pass "node-pty linux-x64 prebuild exists" || fail "node-pty prebuild" "not found at $PTY_PREBUILD"

echo ""; hr; echo "  Test 2: Pi version meets piCompatibility.minimum"; hr

if [ -f "$PI_PKG_JSON" ] && [ -f "$SERVER_PKG_JSON" ] && [ -x "$BUNDLED_NODE" ]; then
  FLOOR_CHECK=$("$BUNDLED_NODE" -e "
    const fs = require('fs');
    const pi = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const server = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const min = server.piCompatibility && server.piCompatibility.minimum;
    if (!min) { console.log('FAIL no piCompatibility.minimum'); process.exit(0); }
    const cmp = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
      return 0;
    };
    if (cmp(pi.version, min) >= 0) console.log('OK pi=' + pi.version + ' min=' + min);
    else console.log('FAIL pi=' + pi.version + ' < min=' + min);
  " "$PI_PKG_JSON" "$SERVER_PKG_JSON")
  case "$FLOOR_CHECK" in
    OK\ *)   pass "Pi floor satisfied (${FLOOR_CHECK#OK }) " ;;
    FAIL\ *) fail "Pi floor"   "${FLOOR_CHECK#FAIL }" ;;
    *)       fail "Pi floor"   "unexpected output: $FLOOR_CHECK" ;;
  esac
else
  fail "Pi floor" "missing manifest(s) or bundled node; cannot verify"
fi

echo ""; hr; echo "  Test 3: Launch Electron app (xvfb headless)"; hr

# Launch the Electron app with a virtual display.
# --no-sandbox is needed because we're in a Docker container.
echo "  → Starting Electron app with xvfb-run..."
xvfb-run -a "$DEB_ROOT/pi-dashboard" --no-sandbox \
  > /tmp/electron.log 2>&1 &
ELECTRON_PID=$!
echo "  → Electron PID: $ELECTRON_PID"

# Wait for the dashboard server to become available
DEADLINE=$((SECONDS + 60))
SERVER_UP=false
PORT=8000

while [ $SECONDS -lt $DEADLINE ]; do
  sleep 2
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    echo "  ⚠ Electron process exited early"
    break
  fi
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
  fail "Dashboard server" "did not start within 60s"
  echo ""
  echo "  Electron log (last 30 lines):"
  tail -30 /tmp/electron.log 2>/dev/null || echo "  (no log)"
  echo ""
  echo "  Server log:"
  cat "$HOME/.pi-dashboard/server.log" 2>/dev/null | tail -30 || echo "  (no server log)"
fi

echo ""; hr; echo "  Test 4: Clean shutdown"; hr

# Kill Electron — this should trigger the quit handler which stops the server
if kill -0 "$ELECTRON_PID" 2>/dev/null; then
  kill "$ELECTRON_PID" 2>/dev/null || true
  for i in $(seq 1 10); do
    if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then break; fi
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

echo ""; hr; echo "  Results"; hr; echo ""
for t in "${TESTS[@]}"; do echo "  $t"; done
echo ""; echo "  $PASS passed, $FAIL failed"; echo ""

[ $FAIL -gt 0 ] && exit 1 || exit 0
