#!/usr/bin/env bash
# Take a screenshot of the iOS simulator showing the pi-dashboard.
#
# Usage:
#   bash scripts/screenshot.sh [URL]   → screenshot to STDOUT path
#   bash scripts/screenshot.sh --help  → usage
#
# Env vars:
#   PI_DASHBOARD_URL   Dashboard URL (default: http://127.0.0.1:8000)
#   SIM_NAME           Simulator name (default: PWA-Test)
#   IOS_PLATFORM_VERSION  iOS version (default: 26.4)
#   SIM_UDID           Direct UDID override (skips auto-detect)
#
# Output: prints the path to the screenshot PNG on success, exits non-zero on failure.

set -euo pipefail

DASHBOARD_URL="${PI_DASHBOARD_URL:-http://127.0.0.1:8000}"
SIM_NAME="${SIM_NAME:-PWA-Test}"
PLATFORM_VERSION="${IOS_PLATFORM_VERSION:-26.4}"
OUT_DIR="${TMPDIR:-/tmp}/pi-screenshots"
SCREENSHOT_PATH=""

cleanup() {
  # Ensure simulator is left in a usable state
  if [[ -n "${UDID:-}" ]]; then
    xcrun simctl shutdown "$UDID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Prerequisites ──────────────────────────────────────────────────

if ! command -v xcrun &>/dev/null; then
  echo "ERROR: xcrun not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

if ! xcrun simctl help &>/dev/null; then
  echo "ERROR: simctl not available. Ensure Xcode is installed." >&2
  exit 1
fi

# ── Dashboard health check ─────────────────────────────────────────

if ! curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/api/health" 2>/dev/null | grep -q "200"; then
  echo "ERROR: Dashboard not responding at $DASHBOARD_URL" >&2
  echo "Start the dashboard first: npx tsx packages/server/src/cli.ts start --dev" >&2
  exit 1
fi

# ── Find simulator ─────────────────────────────────────────────────

# Build the jq filter piece by piece — avoid heredoc escapes
JQ_SIM_FILTER='.devices | to_entries | map(.value) | flatten | map(select(.name == $name and .availabilityError == null)) | first'

if [[ -n "${SIM_UDID:-}" ]]; then
  UDID="$SIM_UDID"
  echo "Using provided SIM_UDID=$UDID" >&2
else
  RUNTIME_ID=$(xcrun simctl list runtimes --json 2>/dev/null | \
    python3 -c "
import json, sys
data = json.load(sys.stdin)
for rt in data.get('runtimes', []):
    if rt.get('name','').startswith('iOS') and '${PLATFORM_VERSION}' in rt.get('version',''):
        print(rt['identifier'])
        break
" 2>/dev/null)

  if [[ -z "$RUNTIME_ID" ]]; then
    echo "ERROR: iOS ${PLATFORM_VERSION} runtime not found" >&2
    xcrun simctl list runtimes --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for rt in data.get('runtimes', []):
    n = rt.get('name','')
    if n.startswith('iOS'):
        print(f'  {rt[\"version\"]} ({rt[\"identifier\"]})')
" >&2
    exit 1
  fi

  # Find UDID by name AND runtime to avoid stale entries
  UDID=$(xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
devices = data.get('devices', {}).get('$RUNTIME_ID', [])
for d in devices:
    if d.get('name') == '$SIM_NAME':
        print(d['udid'])
        break
" 2>/dev/null)

  if [[ -z "$UDID" ]]; then
    echo "ERROR: Simulator '$SIM_NAME' (iOS ${PLATFORM_VERSION}) not found" >&2
    echo "Create it: npm run ios-visual:sim:create" >&2
    exit 1
  fi
fi

echo "Simulator UDID: $UDID" >&2

# ── Boot simulator if needed ───────────────────────────────────────

BOOT_STATUS=$(xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for rt_devices in data.get('devices', {}).values():
    for d in rt_devices:
        if d.get('udid') == '$UDID':
            print(d.get('state', 'unknown'))
            sys.exit(0)
print('unknown')
")

if [[ "$BOOT_STATUS" != "Booted" ]]; then
  echo "Booting simulator..." >&2
  xcrun simctl boot "$UDID"

  # Wait for boot to complete
  for i in $(seq 1 30); do
    STATE=$(xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for rt_devices in data.get('devices', {}).values():
    for d in rt_devices:
        if d.get('udid') == '$UDID':
            print(d.get('state', ''))
            sys.exit(0)
")
    if [[ "$STATE" == "Booted" ]]; then
      break
    fi
    sleep 1
  done
  echo "Simulator booted" >&2
else
  echo "Simulator already booted" >&2
fi

# ── Open URL in Safari ─────────────────────────────────────────────

echo "Opening $DASHBOARD_URL in Safari..." >&2
xcrun simctl openurl "$UDID" "$DASHBOARD_URL"

# Wait for page load
sleep 4

# ── Take screenshot ────────────────────────────────────────────────

mkdir -p "$OUT_DIR"
SCREENSHOT_PATH="$OUT_DIR/screenshot-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$UDID" screenshot "$SCREENSHOT_PATH"
echo "Screenshot saved: $SCREENSHOT_PATH" >&2

# Print the path for the caller
echo "$SCREENSHOT_PATH"
