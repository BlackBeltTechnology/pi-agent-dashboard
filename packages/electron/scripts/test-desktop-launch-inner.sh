#!/usr/bin/env bash
#
# Desktop-launch simulation test.
# Runs with a MINIMAL PATH — no node/npm on system — exactly like a .desktop
# launcher. Verifies the Electron app discovers the bundled node/jiti loader
# and boots the server without a system Node.
#
# Rewrite scope: this script previously simulated a wizard runtime-install
# (npm install tsx + @mariozechner/pi-coding-agent) and a manual server
# launch through tsx. Both flows were deleted under change
# `eliminate-electron-runtime-install` — the DEB now ships pi/openspec/tsx
# pre-installed in the bundle, and the only launch path is the Electron
# main process spawning `bundled-node --import <jiti> <cli.ts>`. The wizard
# + manual-tsx stages are gone; the core minimal-PATH Electron launch
# assertion stays.
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

# ── Minimal desktop PATH ────────────────────────────────────────
# This is what a .desktop file / Electron app gets on Linux.
# NO node, NO npm, NO ~/.local/bin — just base system dirs.
DESKTOP_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

DEB_ROOT="/usr/lib/pi-dashboard"
RESOURCES="$DEB_ROOT/resources"
SERVER_BUNDLE="$RESOURCES/server"
BUNDLED_NODE="$RESOURCES/node/bin/node"
PI_PKG_JSON="$SERVER_BUNDLE/node_modules/@earendil-works/pi-coding-agent/package.json"
SERVER_PKG_JSON="$SERVER_BUNDLE/node_modules/@blackbelt-technology/pi-dashboard-server/package.json"

hr; echo "  Test 0: Verify environment is minimal (no node)"; hr

if env PATH="$DESKTOP_PATH" which node 2>/dev/null; then
  fail "Environment" "node found on desktop PATH — test is invalid"
  exit 1
else
  pass "No system node on desktop PATH"
fi

if [ -x "$BUNDLED_NODE" ]; then
  pass "Bundled node exists: $($BUNDLED_NODE --version)"
else
  fail "Bundled node" "not found at $BUNDLED_NODE"
  exit 1
fi

echo ""; hr; echo "  Test 1: Pi version meets piCompatibility.minimum"; hr

if [ -f "$PI_PKG_JSON" ] && [ -f "$SERVER_PKG_JSON" ]; then
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
  fail "Pi floor" "missing manifest(s); cannot verify"
fi

echo ""; hr; echo "  Test 2: Electron app launch with desktop PATH"; hr

# Launch the REAL Electron app with minimal desktop PATH.
# The Electron app must discover bundled node via its own resource layout
# (no PATH lookup) and spawn the server with `--import <jiti> <cli.ts>`.
echo "  → Starting Electron app with desktop PATH=$DESKTOP_PATH"
env -i HOME="$HOME" PATH="$DESKTOP_PATH" DISPLAY="${DISPLAY:-}" \
  xvfb-run -a "$DEB_ROOT/pi-dashboard" --no-sandbox \
  > /tmp/electron.log 2>&1 &
ELECTRON_PID=$!

PORT=8000  # Default port
DEADLINE=$((SECONDS + 60))
ELECTRON_SERVER_UP=false

while [ $SECONDS -lt $DEADLINE ]; do
  sleep 2
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    echo "  ⚠ Electron exited early"
    break
  fi
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>/dev/null; then
    ELECTRON_SERVER_UP=true
    break
  fi
  echo "  ... waiting ($((DEADLINE - SECONDS))s remaining)"
done

if [ "$ELECTRON_SERVER_UP" = true ]; then
  pass "Electron app launched server with desktop PATH"

  # Test session spawn from Electron-launched server
  SPAWN_DIR=$(mktemp -d)
  SPAWN_RESP=$(curl -sf -X POST "http://localhost:$PORT/api/session/spawn" \
    -H "Content-Type: application/json" \
    -d "{\"cwd\": \"$SPAWN_DIR\"}" 2>&1 || echo '{"success":false}')

  if echo "$SPAWN_RESP" | grep -q '"success":true'; then
    pass "Session spawn from Electron-launched server"
    sleep 4
    if ps aux 2>/dev/null | grep -v grep | grep -q "\-\-mode.*rpc"; then
      pass "pi process running from Electron-launched server"
      pkill -f "\-\-mode.*rpc" 2>/dev/null || true
    else
      fail "pi process (Electron)" "not found"
      echo "    Server log:"
      cat "$HOME/.pi-dashboard/server.log" 2>/dev/null | tail -10 || true
    fi
  else
    fail "Session spawn (Electron)" "response: $SPAWN_RESP"
  fi
  rm -rf "$SPAWN_DIR"
else
  fail "Electron server launch" "server didn't start within 60s"
  echo "  Electron log:"
  tail -20 /tmp/electron.log 2>/dev/null || true
  echo "  Server log:"
  cat "$HOME/.pi-dashboard/server.log" 2>/dev/null | tail -20 || true
fi

# Cleanup
kill "$ELECTRON_PID" 2>/dev/null || true
sleep 1
curl -sf -X POST "http://localhost:$PORT/api/shutdown" > /dev/null 2>&1 || true

echo ""; hr; echo "  Results"; hr; echo ""
for t in "${TESTS[@]}"; do echo "  $t"; done
echo ""; echo "  $PASS passed, $FAIL failed"; echo ""

[ $FAIL -gt 0 ] && exit 1 || exit 0
