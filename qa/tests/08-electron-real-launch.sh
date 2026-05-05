#!/usr/bin/env bash
# Test: real Electron AppImage launch on Linux under xvfb-run.
#
# Asserts:
#   1. Main process reaches a healthy /api/health within 90 s.
#   2. /api/health.starter == "Electron".
#   3. ~/.pi/dashboard/server.log is non-empty (catches spawnDetached
#      stdio[1]='ignore' regression).
#   4. Electron parent stdout/stderr does not contain "FATAL"
#      (catches the v0.4.6 jiti FATAL bug from a degraded managed dir).
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

# Assert no FATAL in Electron stdout (Bug 1 regression guard).
if grep -q "FATAL" "$ELECTRON_LOG"; then
  echo "FAIL: FATAL found in Electron stdout (jiti FATAL regression?):"
  grep -n "FATAL" "$ELECTRON_LOG" | head -5
  exit 1
fi
echo "  ✓ no FATAL in Electron parent stdout"

echo "PASS: Electron real-launch smoke succeeded"
exit 0
