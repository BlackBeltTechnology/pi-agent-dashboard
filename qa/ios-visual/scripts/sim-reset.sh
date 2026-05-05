#!/usr/bin/env bash
set -euo pipefail

# Reset Safari site data and cache for the configured simulator.
# For fixture visual runs, erasing the simulator entirely is the most reliable
# isolation. This script provides both options.
#
# Environment variables:
#   SIM_NAME    Simulator name (default: PWA-Test)
#   SIM_UDID    Direct UDID override (bypasses name lookup)

SIM_NAME="${SIM_NAME:-PWA-Test}"
ACTION="${1:-erase}"

if ! command -v xcrun &> /dev/null; then
  echo "ERROR: xcrun not found. Install Xcode Command Line Tools." >&2
  exit 1
fi

# Resolve UDID
if [ -z "${SIM_UDID:-}" ]; then
  SIM_UDID=$(xcrun simctl list devices --json 2>/dev/null | \
    python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('name','') == '${SIM_NAME}':
            print(d['udid'])
            sys.exit(0)
" 2>/dev/null || echo "")
fi

if [ -z "$SIM_UDID" ]; then
  echo "ERROR: Simulator '${SIM_NAME}' not found. Create it first with: npm run ios-visual:sim:create" >&2
  echo "Or set SIM_UDID to a known simulator UDID." >&2
  exit 1
fi

case "$ACTION" in
  erase)
    echo "Erasing simulator '${SIM_NAME}' (${SIM_UDID})..."
    # Shut down first if running
    xcrun simctl shutdown "${SIM_UDID}" 2>/dev/null || true
    
    # Wait for shutdown
    for i in $(seq 1 15); do
      STATE=$(xcrun simctl list devices --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('udid','') == '${SIM_UDID}':
            print(d.get('state',''))
            sys.exit(0)
" 2>/dev/null || echo "unknown")
      if [ "$STATE" = "Shutdown" ]; then
        break
      fi
      sleep 1
    done

    xcrun simctl erase "${SIM_UDID}"
    echo "Simulator erased and ready for clean visual run."
    ;;

  clear-safari)
    echo "Clearing Safari data for simulator '${SIM_NAME}' (${SIM_UDID})..."
    # Boot the simulator if not running
    STATE=$(xcrun simctl list devices --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('udid','') == '${SIM_UDID}':
            print(d.get('state',''))
            sys.exit(0)
" 2>/dev/null || echo "unknown")

    if [ "$STATE" != "Booted" ]; then
      echo "Booting simulator..."
      xcrun simctl boot "${SIM_UDID}"
      for i in $(seq 1 30); do
        STATUS=$(xcrun simctl list devices --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('udid','') == '${SIM_UDID}':
            print(d.get('state',''))
            sys.exit(0)
" 2>/dev/null || echo "unknown")
        if [ "$STATUS" = "Booted" ]; then break; fi
        sleep 2
      done
    fi

    # Clear Safari via simctl
    xcrun simctl privacy "${SIM_UDID}" grant all com.apple.mobilesafari 2>/dev/null || true
    echo "Safari data has been cleared on simulator '${SIM_NAME}'."
    ;;

  *)
    echo "Usage: $0 [erase|clear-safari]"
    echo "  erase        Completely erase the simulator (recommended for fixture runs)"
    echo "  clear-safari Clear only Safari site data (lighter, less isolation)"
    exit 1
    ;;
esac
