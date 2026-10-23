#!/usr/bin/env bash
# Test: real Electron AppImage launch on Linux under xvfb-run.
#
# Asserts:
#   1. Main process reaches a healthy /api/health within 90 s.
#   2. /api/health.starter == "Electron".
#   3. ~/.pi/dashboard/server.log is non-empty (catches spawnDetached
#      stdio[1]='ignore' regression).
#   4. Electron parent stdout/stderr does not contain "FATAL"
#      (catches the v0.4.6 loader FATAL bug from a degraded managed dir).
#   5. server.log spawn header names native-ts-register.mjs (native TS loader).
#
# Skips with exit 0 when AppImage artifact is absent (common on PR
# runs without `npm run make`). Fails with actionable message when
# xvfb-run is missing (provisioning gap, not optional artifact).
#
# See change: expand-electron-qa-coverage.

set -euo pipefail

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  # Try common locations the QA harness might drop the AppImage at.
  for cand in \
    "$HOME/Downloads/PI-Dashboard-"*.AppImage \
    "$HOME/PI-Dashboard-"*.AppImage \
    "/tmp/PI-Dashboard-"*.AppImage \
    "$(pwd)/packages/electron/out/make/AppImage/"*/PI-Dashboard-*.AppImage; do
    if [ -f "$cand" ]; then APPIMAGE="$cand"; break; fi
  done
fi

if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "SKIP: AppImage artifact missing — run 'npm run make' first or pass path as \$1"
  exit 0
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "FAIL: xvfb-run not found on PATH"
  echo "  Required for headless Electron launch on Linux QA VMs."
  echo "  Add 'xvfb' to qa/packer/scripts/linux/install-deps.sh and rebuild the base image."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "FAIL: curl not found on PATH"
  exit 1
fi

echo "=== Test: Electron real launch (headless, xvfb) ==="
echo "AppImage: $APPIMAGE"

ELECTRON_LOG="/tmp/electron-stdout-$$.log"
SERVER_LOG="$HOME/.pi/dashboard/server.log"
PORT=8000

# Wipe any stale server log so size assertion reflects this run only.
rm -f "$SERVER_LOG"

# ── OpenSpec config-read regression seed (fix-openspec-config-read-bundled-node) ─
# Reproduce the affected managed-bin topology: a `.bin/openspec` symlink → a real
# `bin/openspec.js` `#!/usr/bin/env node` shebang script. Pre-fix the GUI server's
# stripped PATH cannot run the shebang (env: node → exit 127), so the CLI read
# fails and GET /api/openspec/config returns 502. Post-fix the argv is node-wrapped
# by absolute node path, so it resolves regardless of PATH. Also seed the global
# config the CLI reads (~/.config/openspec/config.json). Strong-assert when the
# seed lands; SKIP the openspec assertion only if it cannot be created.
seed_openspec() {
  local managed="$HOME/.pi-dashboard/node_modules"
  local pkgdir="$managed/@fission-ai/openspec/bin"
  local bindir="$managed/.bin"
  OS_CONFIG="$HOME/.config/openspec/config.json"
  OPENSPEC_SEEDED=false
  mkdir -p "$pkgdir" "$bindir" "$(dirname "$OS_CONFIG")" 2>/dev/null || return 0
  cat > "$pkgdir/openspec.js" <<'OSJS'
#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const a = process.argv.slice(2);
if (a[0] === "config" && a[1] === "list") {
  const f = path.join(os.homedir(), ".config", "openspec", "config.json");
  let c = {};
  try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  process.stdout.write(JSON.stringify({
    profile: c.profile ?? "custom",
    delivery: c.delivery ?? "both",
    workflows: Array.isArray(c.workflows) ? c.workflows : [],
  }));
  process.exit(0);
}
process.exit(0);
OSJS
  chmod +x "$pkgdir/openspec.js"
  ln -sf "../@fission-ai/openspec/bin/openspec.js" "$bindir/openspec"
  cat > "$OS_CONFIG" <<'OSCFG'
{
  "profile": "core",
  "delivery": "both",
  "workflows": ["propose", "explore", "apply", "archive"]
}
OSCFG
  if [ -L "$bindir/openspec" ] && [ -f "$OS_CONFIG" ]; then
    OPENSPEC_SEEDED=true
    echo "  ✓ seeded managed-bin openspec symlink + global config"
  fi
}
seed_openspec

# Launch under xvfb. --no-sandbox is required for non-root containers /
# unprivileged user namespaces; matches what the Linux Docker harness
# already uses for similar headless runs.
xvfb-run -a "$APPIMAGE" --no-sandbox > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

cleanup() {
  if kill -0 "$ELECTRON_PID" 2>/dev/null; then
    # Kill the Electron process tree (xvfb-run wraps Electron in a
    # subshell; pkill -P catches direct children, then SIGTERM the
    # leader as fallback).
    pkill -P "$ELECTRON_PID" 2>/dev/null || true
    kill "$ELECTRON_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$ELECTRON_PID" 2>/dev/null || true
  fi
  # Belt-and-suspenders: kill anything still bound to the dashboard port.
  pkill -f "pi-dashboard.exe\|pi-dashboard\|electron" 2>/dev/null || true
}
trap cleanup EXIT

# Poll /api/health.
DEADLINE=$((SECONDS + 90))
HEALTH_BODY=""
while [ $SECONDS -lt $DEADLINE ]; do
  sleep 2
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    echo "FAIL: Electron process exited before /api/health responded"
    echo "  Last 60 lines of stdout:"
    tail -60 "$ELECTRON_LOG" 2>/dev/null || echo "  (no log)"
    exit 1
  fi
  if HEALTH_BODY=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null); then
    break
  fi
done

if [ -z "$HEALTH_BODY" ]; then
  echo "FAIL: /api/health did not respond within 90s"
  echo "  Last 60 lines of Electron stdout:"
  tail -60 "$ELECTRON_LOG" 2>/dev/null || echo "  (no log)"
  exit 1
fi
echo "  ✓ /api/health responded"

# Assert starter == Electron. Use node to parse JSON safely.
STARTER=$(node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).starter||'?')}catch{process.stdout.write('?')}})" \
  <<< "$HEALTH_BODY")
if [ "$STARTER" != "Electron" ]; then
  echo "FAIL: expected starter=Electron, got $STARTER"
  exit 1
fi
echo "  ✓ starter == Electron"

# Assert ~/.pi/dashboard/server.log non-empty (Bug 2 regression guard).
if [ ! -f "$SERVER_LOG" ]; then
  echo "FAIL: $SERVER_LOG missing after successful spawn"
  exit 1
fi
if [ ! -s "$SERVER_LOG" ]; then
  echo "FAIL: $SERVER_LOG is 0 bytes after successful spawn (spawnDetached stdio regression?)"
  exit 1
fi
echo "  ✓ server.log non-empty ($(wc -c < "$SERVER_LOG") bytes)"

# The bundled Node 24 server boots on the Node-native strip-only TS loader — its
# only loader; the spawn header names it (test-plan #X5).
# See change: strip-only-native-ts-loader.
if ! grep -aF "launch (parent pid" "$SERVER_LOG" | tail -1 | grep -qF "native-ts-register.mjs"; then
  echo "FAIL: server.log spawn header does not name native-ts-register.mjs:"
  grep -aF "launch (parent pid" "$SERVER_LOG" | tail -1 || echo "  (no launch header)"
  exit 1
fi
echo "  ✓ server.log header names the native TS loader"

# Assert no FATAL in Electron stdout (Bug 1 regression guard).
if grep -q "FATAL" "$ELECTRON_LOG"; then
  echo "FAIL: FATAL found in Electron stdout (loader FATAL regression?):"
  grep -n "FATAL" "$ELECTRON_LOG" | head -5
  exit 1
fi
echo "  ✓ no FATAL in Electron parent stdout"

# Strict `requireLocalProof` default (test-plan #X8): the app's own requests carry local proof, so the
# launch must not be refused anywhere. See change: close-container-loopback-impersonation (D5).
if grep -q "local_proof_required" "$ELECTRON_LOG"; then
  echo "FAIL: a local_proof_required refusal reached the Electron log (the app's own request lacked proof):"
  grep -n "local_proof_required" "$ELECTRON_LOG" | head -5
  exit 1
fi
if grep -q "\[local-proof\] refused" "$SERVER_LOG"; then
  echo "FAIL: the server refused a request for want of local proof during the app launch:"
  grep -n "\[local-proof\] refused" "$SERVER_LOG" | head -5
  exit 1
fi
echo "  ✓ no local_proof_required refusal during launch (app requests carry proof)"

# ── OpenSpec config-read assertion (fix-openspec-config-read-bundled-node) ──
# curl -sf returns non-zero on the 502 the stripped-PATH bug produces, so an
# empty body IS the pre-fix failure signal. Post-fix: 200 + the seeded profile.
if [ "${OPENSPEC_SEEDED:-false}" = true ]; then
  OS_BODY=$(curl -sf "http://localhost:$PORT/api/openspec/config" 2>/dev/null || true)
  if [ -z "$OS_BODY" ]; then
    echo "FAIL: GET /api/openspec/config did not return 200"
    echo "  Bundled-node stripped-PATH regression: the openspec shebang died"
    echo "  (exit 127) so the CLI read failed and the route returned 502."
    exit 1
  fi
  OS_PROFILE=$(node -e \
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write((j.data&&j.data.profile)||'?')}catch{process.stdout.write('?')}})" \
    <<< "$OS_BODY")
  if [ "$OS_PROFILE" != "core" ]; then
    echo "FAIL: expected openspec profile=core from seeded config, got '$OS_PROFILE'"
    echo "  Body: $OS_BODY"
    exit 1
  fi
  echo "  ✓ GET /api/openspec/config → 200, profile=core (seeded)"
else
  echo "  SKIP: openspec seed unavailable — skipping config-read assertion"
fi

# ── Runtime plugin delivery on the PACKAGED app (test-plan #E103, task 8.143) ──
# D4 packaging + the import map on a packaged Electron: the bundled server tree ships `mcp-core`
# (BUNDLED_WORKSPACE_PKGS — the static half is pinned by scripts/__tests__/qa-dist-only-scripts.test.mjs),
# the served HTML carries the host import map, `/host/react.js` is served, and every plugin the build
# bundled reports `client.delivery:"bundled"` (never `runtime`). See change: decouple-plugins-from-core.
#   a. a bundled server tree found under ~/.pi-dashboard ⇒ `packages/mcp-core` sits beside it
SERVER_PKG_DIR=$(find "$HOME/.pi-dashboard" -maxdepth 6 -type d -path '*/packages/server' 2>/dev/null | head -1 || true)
if [ -n "$SERVER_PKG_DIR" ]; then
  if [ ! -d "$(dirname "$SERVER_PKG_DIR")/mcp-core" ]; then
    echo "FAIL: bundled server tree $SERVER_PKG_DIR has no sibling packages/mcp-core (BUNDLED_WORKSPACE_PKGS regression)"
    exit 1
  fi
  echo "  ✓ bundled server tree ships packages/mcp-core"
else
  echo "  NOTE: no extracted bundled server tree under ~/.pi-dashboard — mcp-core presence not probed here"
fi
#   b. import map in the served shell
ROOT_HTML=$(curl -sf "http://localhost:$PORT/" 2>/dev/null || true)
if ! printf '%s' "$ROOT_HTML" | grep -q '<script type="importmap"'; then
  echo "FAIL: GET / carries no <script type=\"importmap\"> (packaged shell lost the host import map)"
  exit 1
fi
echo "  ✓ GET / carries the host import map"
#   c. the host shim the map points at
HOST_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/host/react.js" 2>/dev/null || echo 000)
if [ "$HOST_CODE" != "200" ]; then
  echo "FAIL: GET /host/react.js answered $HOST_CODE (expected 200)"
  exit 1
fi
echo "  ✓ /host/react.js → 200"
#   d. bundled plugins report delivery bundled (≥1, none runtime)
PLUGINS_BODY=$(curl -sf "http://localhost:$PORT/api/plugins" 2>/dev/null || true)
DELIVERY=$(printf '%s' "$PLUGINS_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const rows=(JSON.parse(s).plugins||[]).filter(p=>p.status&&p.status.source==='bundled'&&p.status.client);const b=rows.filter(p=>p.status.client.delivery==='bundled').length;const r=rows.filter(p=>p.status.client.delivery==='runtime').map(p=>p.id);process.stdout.write(b+' '+r.join(','))}catch{process.stdout.write('? ')}})")
BUNDLED_N=${DELIVERY%% *}
RUNTIME_IDS=${DELIVERY#* }
if [ "$BUNDLED_N" = "?" ] || [ "$BUNDLED_N" = "0" ]; then
  echo "FAIL: no bundled-source plugin reports client.delivery:bundled (got '$DELIVERY'; body: ${PLUGINS_BODY:0:300})"
  exit 1
fi
if [ -n "$RUNTIME_IDS" ]; then
  echo "FAIL: bundled-source plugin(s) report client.delivery:runtime: $RUNTIME_IDS"
  exit 1
fi
echo "  ✓ $BUNDLED_N bundled plugin(s) report client.delivery:bundled, none runtime"

echo "PASS: Electron real-launch smoke succeeded"
exit 0
