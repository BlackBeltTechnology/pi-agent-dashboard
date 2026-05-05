#!/usr/bin/env bash
set -euo pipefail

# Print or export the UDID of the configured simulator.
#
# Environment variables:
#   SIM_NAME    Simulator name to look up (default: PWA-Test)

SIM_NAME="${SIM_NAME:-PWA-Test}"

if ! command -v xcrun &> /dev/null; then
  echo "ERROR: xcrun not found. Install Xcode Command Line Tools." >&2
  exit 1
fi

UDID=$(xcrun simctl list devices --json 2>/dev/null | \
  python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for device in devices:
        if device.get('name','') == '${SIM_NAME}':
            print(device['udid'])
            sys.exit(0)
print('', end='')
" 2>/dev/null || echo "")

if [ -z "$UDID" ]; then
  echo "ERROR: Simulator '${SIM_NAME}' not found." >&2
  echo "Available simulators:" >&2
  xcrun simctl list devices --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        print(f'  {d[\"name\"]} — {d[\"udid\"]}')
" >&2
  exit 1
fi

# Print in eval-friendly format and also export
echo "SIM_UDID=${UDID}"
export SIM_UDID="${UDID}"
