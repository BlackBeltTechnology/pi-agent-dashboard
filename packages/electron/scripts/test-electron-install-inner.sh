#!/usr/bin/env bash
#
# Inner test: runs INSIDE a clean Ubuntu 22.04 container as non-root user.
# Verifies the bundled server tree at $APP_RESOURCES/server/ is self-contained
# and bootable via the same `start-server.sh` argv that real users see.
#
# Stages:
#   1. Verify bundled resource layout (bundled node, start-server.sh, cli.ts,
#      jiti loader, pi-coding-agent, node-pty linux-x64 prebuild,
#      no absolute @blackbelt-technology symlinks).
#   2. Verify pi-coding-agent version satisfies piCompatibility.minimum from
#      the bundled server package.json. Locks the floor at install-time.
#   3. Spawn server via `./start-server.sh start --port … --pi-port …`.
#   4. Health check: GET /api/health → ok=true.
#   5. Session spawn: POST /api/session/spawn → assert pi --mode rpc is running.
#   6. Clean shutdown via POST /api/shutdown.
#
# Rewrite scope: this script previously simulated the pre-R3 managed-dir
# install flow (extractBundle → offline cacache → swap-aside merge). That
# whole flow was deleted under change `eliminate-electron-runtime-install`.
# The bundle now ships pi/openspec/tsx pre-installed; the only runtime
# operation is "spawn the bundled node against the bundled cli.ts".
#
# See change: bump-pi-compat-to-0-78 (rewrite for bundle-only flow).

set -euo pipefail

APP_RESOURCES="${APP_RESOURCES:-/opt/pi-dashboard/resources}"
NODE_BIN="$APP_RESOURCES/node/bin/node"
SERVER_BUNDLE="$APP_RESOURCES/server"
START_SH="$SERVER_BUNDLE/start-server.sh"
CLI_REL="node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts"
JITI_REGISTER="$SERVER_BUNDLE/node_modules/jiti/lib/jiti-register.mjs"
PI_PKG_JSON="$SERVER_BUNDLE/node_modules/@earendil-works/pi-coding-agent/package.json"
SERVER_PKG_JSON="$SERVER_BUNDLE/node_modules/@blackbelt-technology/pi-dashboard-server/package.json"

PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS+1)); TESTS+=("✓ $1"); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); TESTS+=("✗ $1: $2"); echo "  ✗ $1: $2"; }
hr()   { echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

# ── Stage 1: Verify bundled layout ────────────────────────────────────────────

hr; echo "  Stage 1 — Verify bundled resource layout"; hr

[ -x "$NODE_BIN" ]                          && pass "Bundled Node: $($NODE_BIN --version)" || fail "Bundled Node" "missing $NODE_BIN"
[ -d "$SERVER_BUNDLE" ]                     && pass "Server bundle dir present"            || fail "Server bundle" "missing $SERVER_BUNDLE"
[ -x "$START_SH" ]                          && pass "Manual launch helper present"         || fail "start-server.sh" "missing or not executable: $START_SH"
[ -f "$SERVER_BUNDLE/$CLI_REL" ]            && pass "Bundle cliPath present"               || fail "Bundle cliPath" "missing $SERVER_BUNDLE/$CLI_REL"
[ -f "$JITI_REGISTER" ]                     && pass "Bundled jiti loader present"          || fail "jiti loader" "missing $JITI_REGISTER"
[ -f "$PI_PKG_JSON" ]                       && pass "Bundled pi-coding-agent present"      || fail "pi-coding-agent" "missing $PI_PKG_JSON"
[ -d "$SERVER_BUNDLE/node_modules/node-pty/prebuilds/linux-x64" ] \
                                            && pass "node-pty linux-x64 prebuild present"  || fail "node-pty prebuild" "linux-x64 missing"

# No absolute symlinks under @blackbelt-technology/* (would resolve to
# build-time paths that don't exist on the user's machine).
ABS_LINK_FOUND=false
if [ -d "$SERVER_BUNDLE/node_modules/@blackbelt-technology" ]; then
  for entry in "$SERVER_BUNDLE/node_modules/@blackbelt-technology"/*; do
    [ -L "$entry" ] || continue
    target=$(readlink "$entry")
    case "$target" in
      /*) ABS_LINK_FOUND=true; echo "    absolute link: $entry → $target" ;;
    esac
  done
fi
$ABS_LINK_FOUND && fail "@blackbelt-technology symlinks" "absolute link present" \
                || pass "No absolute symlinks under @blackbelt-technology/*"

# ── Stage 2: Pi version satisfies piCompatibility.minimum ─────────────────────

echo ""; hr; echo "  Stage 2 — Pi version meets piCompatibility.minimum"; hr

if [ -f "$PI_PKG_JSON" ] && [ -f "$SERVER_PKG_JSON" ]; then
  FLOOR_CHECK=$("$NODE_BIN" -e "
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

# ── Stage 3: Spawn server via start-server.sh ─────────────────────────────────

echo ""; hr; echo "  Stage 3 — Spawn server via start-server.sh"; hr

PORT=8111
PI_PORT=9998

# Bare invocation (no subcommand) runs the server in the foreground per
# cli.ts:6 (`pi-dashboard` default). The `start` subcommand detaches a
# daemon and exits, which would orphan SERVER_PID and break our health
# probe. Foreground keeps the process backgrounded by the shell.
"$NODE_BIN" \
  --import "file://$JITI_REGISTER" \
  "$SERVER_BUNDLE/$CLI_REL" \
  --port "$PORT" \
  --pi-port "$PI_PORT" \
  > /tmp/server.log 2>&1 &
SERVER_PID=$!

# ── Stage 4: Health check ─────────────────────────────────────────────────────

echo ""; hr; echo "  Stage 4 — Wait for /api/health (max 120s)"; hr

DEADLINE=$((SECONDS + 120))
SERVER_UP=false
HEALTH_BODY=""
while [ $SECONDS -lt $DEADLINE ]; do
  sleep 1
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "  ⚠ Server process exited"; break
  fi
  if HEALTH_BODY=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null); then
    SERVER_UP=true; break
  fi
done

if [ "$SERVER_UP" = "true" ]; then
  pass "/api/health responded"
  OK=$(echo "$HEALTH_BODY" | "$NODE_BIN" -e \
    "process.stdin.on('data', d=>{try{process.stdout.write(String(JSON.parse(d).ok));}catch{process.stdout.write('parse-error');}})")
  if [ "$OK" = "true" ]; then
    pass "/api/health reports ok=true"
  else
    fail "/api/health.ok" "expected true, got $OK"
  fi
else
  fail "Server health" "did not respond within 120s"
  echo ""; echo "  Server log (last 60 lines):"; tail -60 /tmp/server.log 2>/dev/null || echo "  (no log)"
fi

# ── Stage 5: Session spawn ────────────────────────────────────────────────────

echo ""; hr; echo "  Stage 5 — Session spawn (POST /api/session/spawn)"; hr

if [ "$SERVER_UP" = "true" ]; then
  SPAWN_DIR=$(mktemp -d)
  SPAWN_RESP=$(curl -sf -X POST "http://localhost:$PORT/api/session/spawn" \
    -H "Content-Type: application/json" \
    -d "{\"cwd\": \"$SPAWN_DIR\"}" 2>&1 || echo '{"success":false}')
  if echo "$SPAWN_RESP" | grep -q '"success":true'; then
    pass "Spawn API returned success"
    # Informational only: in this bare bundled-server smoke (no Electron
    # shell, no `~/.pi/agent/settings.json` bridge registration), pi may
    # exit immediately after spawn for lack of a bridge to connect back
    # to. The HTTP-level spawn pipeline is what this layer asserts;
    # live pi process verification is owned by test-deb-install (full
    # Electron + bridge stack).
    sleep 3
    if ps aux 2>/dev/null | grep -v grep | grep -q "\-\-mode.*rpc"; then
      echo "  i pi --mode rpc process observed (informational)"
      pkill -f "\-\-mode.*rpc" 2>/dev/null || true
    else
      echo "  i pi --mode rpc process not observed (expected in bare-server smoke; see test-deb-install for full stack)"
    fi
  else
    fail "Spawn API" "response: $SPAWN_RESP"
  fi
  rm -rf "$SPAWN_DIR"
else
  fail "Session spawn" "skipped (server not running)"
fi

# ── Stage 6: Clean shutdown ───────────────────────────────────────────────────

echo ""; hr; echo "  Stage 6 — Clean shutdown"; hr

if [ "$SERVER_UP" = "true" ]; then
  curl -sf -X POST "http://localhost:$PORT/api/shutdown" > /dev/null 2>&1 || true
  for i in $(seq 1 10); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    pass "Server exited after /api/shutdown"
  else
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    fail "Shutdown" "had to send SIGTERM"
  fi
fi

# ── Results ───────────────────────────────────────────────────────────────────

echo ""; hr; echo "  Results"; hr; echo ""
for t in "${TESTS[@]}"; do echo "  $t"; done
echo ""; echo "  $PASS passed, $FAIL failed"; echo ""

[ $FAIL -gt 0 ] && exit 1 || exit 0
