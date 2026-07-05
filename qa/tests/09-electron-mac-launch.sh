#!/usr/bin/env bash
# Test: real Electron .app launch on macOS (in-CI, on a GitHub-hosted
# macOS runner with a real Aqua/WindowServer session).
#
# Asserts the same four-point "healthy launch" contract as the Linux
# smoke (08-electron-real-launch.sh):
#   1. Main process reaches a healthy /api/health within 120 s.
#   2. /api/health.launchSource == "electron" (the server's launch-source
#      field; there is no `starter` key in the health response).
#   3. ~/.pi/dashboard/server.log is non-empty (catches spawnDetached
#      stdio[1]='ignore' regression).
#   4. Electron parent stdout/stderr does not contain "FATAL".
#
# macOS specifics vs the Linux script:
#   - Execs the inner Mach-O directly (…/Contents/MacOS/pi-dashboard).
#     NEVER `open` — macOS `open` drops env/args to the bundle and yields
#     an unobservable process (docs/electron-session.md Phase 5).
#   - No --no-sandbox: the runner user session is a real GUI session.
#   - Defensively strips com.apple.quarantine when the bundle is copied
#     from a mounted DMG.
#   - Seeds the first-run marker (~/.pi/dashboard/first-run-done) BEFORE
#     launch. On a fresh runner main.ts's isFirstRun() opens the welcome
#     wizard window and AWAITS its close before spawning the server; with
#     no interactive user that blocks the server spawn indefinitely. The
#     marker skips the wizard so the smoke exercises the server-boot path
#     (its actual contract), not the onboarding window.
#   - Launches with --disable-gpu: GitHub macOS runners have no usable GPU,
#     so GPU/renderer init crashes (exit_code=15) and perturbs startup.
#     This is the macOS analog of running the Linux smoke under xvfb.
#
# LIMITATION — boot-proof, NOT floor-proof. The runner OS (macOS 14/15)
# is ABOVE the advertised minimum floor (LSMinimumSystemVersion 10.15).
# This smoke proves the binary BOOTS on the runner's macOS version only,
# NOT that it boots on the oldest allowed macOS. The complementary
# (label-only) floor check is the static `otool minos` assertion in
# .github/workflows/_electron-build.yml ("Verify macOS deployment target
# floor"). True floor-proof on the oldest allowed macOS remains a
# separate, unimplemented QA gap (needs a macOS-12/-10.15 VM).
#
# Skips with exit 0 when the .app artifact is absent (common on PR runs
# without `npm run make`). Fails with actionable message when curl is
# missing (provisioning gap, not optional artifact).
#
# See change: add-macos-electron-launch-smoke.

set -euo pipefail

# Resolve the .app bundle. Prefer the forge package output under out/;
# fall back to copying out of a mounted DMG (the floor-check step mounts
# one, but in case this runs standalone we scan common drop locations).
APP="${1:-}"
COPIED_FROM_DMG=false

if [ -z "$APP" ]; then
  for cand in \
    "$(pwd)/packages/electron/out/PI-Dashboard-darwin-"*/PI-Dashboard.app \
    "$(pwd)/packages/electron/out/"*/PI-Dashboard.app; do
    if [ -d "$cand" ]; then APP="$cand"; break; fi
  done
fi

# Fallback: resolve from a DMG (mount, copy out so we can strip quarantine
# + leave the read-only image untouched).
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  DMG=""
  for dcand in \
    "$(pwd)/packages/electron/out/make/"*.dmg \
    "$(pwd)/packages/electron/out/make/"*/*.dmg; do
    if [ -f "$dcand" ]; then DMG="$dcand"; break; fi
  done
  if [ -n "$DMG" ]; then
    echo "Resolving .app from DMG: $DMG"
    MOUNT_OUT=$(hdiutil attach -nobrowse -readonly "$DMG")
    MOUNT_POINT=$(echo "$MOUNT_OUT" | grep '/Volumes/' | awk '{$1=$2=""; sub(/^ +/,""); print}' | tail -1)
    SRC_APP=$(find "$MOUNT_POINT" -maxdepth 1 -name '*.app' -type d | head -1)
    if [ -n "$SRC_APP" ]; then
      DEST_DIR="/tmp/pi-mac-smoke-$$"
      mkdir -p "$DEST_DIR"
      cp -R "$SRC_APP" "$DEST_DIR/"
      APP="$DEST_DIR/$(basename "$SRC_APP")"
      COPIED_FROM_DMG=true
    fi
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
fi

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "SKIP: .app missing — run 'npm run make' first or pass path as \$1"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "FAIL: curl not found on PATH"
  exit 1
fi

# Resolve the inner Mach-O. executableName is "pi-dashboard"
# (packages/electron/forge.config.ts); prefer that, fall back to the
# single binary in Contents/MacOS/ if the name ever changes.
BIN="$APP/Contents/MacOS/pi-dashboard"
if [ ! -f "$BIN" ]; then
  BIN=$(find "$APP/Contents/MacOS" -maxdepth 1 -type f -perm -u+x | head -1)
fi
if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
  echo "FAIL: no executable found under $APP/Contents/MacOS"
  exit 1
fi

echo "=== Test: Electron real launch (macOS, direct exec) ==="
echo ".app: $APP"
echo "binary: $BIN"

# Strip Gatekeeper quarantine when the bundle came from a DMG, so the
# launch is not blocked. No-op (best effort) when not quarantined.
if [ "$COPIED_FROM_DMG" = true ]; then
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
fi

ELECTRON_LOG="/tmp/electron-stdout-$$.log"
SERVER_LOG="$HOME/.pi/dashboard/server.log"
PORT=8000

# Wipe any stale server log so the size assertion reflects this run only.
mkdir -p "$(dirname "$SERVER_LOG")"
rm -f "$SERVER_LOG"

# Seed the first-run marker so main.ts's isFirstRun() is false and the
# blocking welcome-wizard window is skipped (no interactive user on CI).
touch "$HOME/.pi/dashboard/first-run-done"

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

# Direct exec of the inner Mach-O — NEVER `open` (open drops env/args and
# yields an unobservable process). No --no-sandbox: real GUI session.
# --disable-gpu: no usable GPU on the runner (macOS analog of xvfb).
"$BIN" --disable-gpu > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

cleanup() {
  if kill -0 "$ELECTRON_PID" 2>/dev/null; then
    pkill -P "$ELECTRON_PID" 2>/dev/null || true
    kill "$ELECTRON_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$ELECTRON_PID" 2>/dev/null || true
  fi
  # Belt-and-suspenders: kill anything still bound to the dashboard port.
  pkill -f "pi-dashboard\|PI Dashboard\|electron" 2>/dev/null || true
  if [ "$COPIED_FROM_DMG" = true ] && [ -n "${DEST_DIR:-}" ]; then
    rm -rf "$DEST_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Poll /api/health. 120 s gives the slower x64 leg margin for a cold
# first-run bootstrap (fresh ~/.pi, no caches).
DEADLINE=$((SECONDS + 120))
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
  echo "FAIL: /api/health did not respond within 120s"
  echo "  Last 60 lines of Electron stdout:"
  tail -60 "$ELECTRON_LOG" 2>/dev/null || echo "  (no log)"
  exit 1
fi
echo "  ✓ /api/health responded"

# Assert launchSource == electron. /api/health exposes `launchSource`
# (lowercase: "electron"/"bridge"/"standalone"), NOT a `starter` field.
# Use node to parse JSON safely.
LAUNCH_SOURCE=$(node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).launchSource||'?')}catch{process.stdout.write('?')}})" \
  <<< "$HEALTH_BODY")
if [ "$LAUNCH_SOURCE" != "electron" ]; then
  echo "FAIL: expected launchSource=electron, got $LAUNCH_SOURCE"
  exit 1
fi
echo "  ✓ launchSource == electron"

# Assert ~/.pi/dashboard/server.log non-empty (stdio-routing regression guard).
if [ ! -f "$SERVER_LOG" ]; then
  echo "FAIL: $SERVER_LOG missing after successful spawn"
  exit 1
fi
if [ ! -s "$SERVER_LOG" ]; then
  echo "FAIL: $SERVER_LOG is 0 bytes after successful spawn (spawnDetached stdio regression?)"
  exit 1
fi
echo "  ✓ server.log non-empty ($(wc -c < "$SERVER_LOG") bytes)"

# Assert no FATAL in Electron stdout (jiti FATAL regression guard).
if grep -q "FATAL" "$ELECTRON_LOG"; then
  echo "FAIL: FATAL found in Electron stdout (jiti FATAL regression?):"
  grep -n "FATAL" "$ELECTRON_LOG" | head -5
  exit 1
fi
echo "  ✓ no FATAL in Electron parent stdout"

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

echo "PASS: Electron macOS real-launch smoke succeeded"
exit 0
