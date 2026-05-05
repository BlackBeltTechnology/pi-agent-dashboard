#!/usr/bin/env bash
set -euo pipefail

# Create or reuse the iOS simulator for PWA visual testing.
# Disables hardware keyboard so software keyboard shows in screenshots.
#
# Environment variables:
#   IOS_DEVICE_NAME       Simulator device type name (default: iPhone 16)
#   IOS_PLATFORM_VERSION  iOS runtime version (default: 26.4)
#   SIM_NAME              Simulator name to create (default: PWA-Test)

# Force software keyboard in iOS Simulator
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false

SIM_NAME="${SIM_NAME:-PWA-Test}"
DEVICE_TYPE="${IOS_DEVICE_NAME:-iPhone 16}"
RUNTIME_VERSION="${IOS_PLATFORM_VERSION:-26.4}"

# Prerequisite checks
if ! command -v xcrun &> /dev/null; then
  echo "ERROR: xcrun not found. Install Xcode Command Line Tools with: xcode-select --install" >&2
  exit 1
fi

if ! xcrun simctl list runtimes &> /dev/null; then
  echo "ERROR: simctl not available. Check Xcode installation." >&2
  exit 1
fi

# Find the runtime
RUNTIME_ID=$(xcrun simctl list runtimes --json 2>/dev/null | \
  python3 -c "
import json,sys
data = json.load(sys.stdin)
for r in data.get('runtimes', []):
    if r.get('name','') == 'iOS ${RUNTIME_VERSION}' and r.get('isAvailable', False):
        print(r['identifier'])
        break
" 2>/dev/null || echo "")

if [ -z "$RUNTIME_ID" ]; then
  echo "ERROR: iOS ${RUNTIME_VERSION} runtime not found or not available." >&2
  echo "Available runtimes:" >&2
  xcrun simctl list runtimes --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for r in data.get('runtimes', []):
    avail = '✓' if r.get('isAvailable') else '✗'
    print(f'  {avail} {r[\"name\"]} ({r[\"identifier\"]})')
" >&2
  exit 1
fi

# Find the device type
DEVICE_TYPE_ID=$(xcrun simctl list devicetypes --json 2>/dev/null | \
  python3 -c "
import json,sys
data = json.load(sys.stdin)
for d in data.get('devicetypes', []):
    if d.get('name','') == '${DEVICE_TYPE}':
        print(d['identifier'])
        break
" 2>/dev/null || echo "")

if [ -z "$DEVICE_TYPE_ID" ]; then
  echo "ERROR: Device type '${DEVICE_TYPE}' not found." >&2
  echo "Common device types: iPhone 16, iPhone 16 Pro, iPhone 16 Pro Max" >&2
  exit 1
fi

# Check if simulator already exists
EXISTING_UDID=$(xcrun simctl list devices --json 2>/dev/null | \
  python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for device in devices:
        if device.get('name','') == '${SIM_NAME}':
            print(device['udid'])
            sys.exit(0)
" 2>/dev/null || echo "")

if [ -n "$EXISTING_UDID" ]; then
  echo "Simulator '${SIM_NAME}' already exists (UDID: ${EXISTING_UDID})."
  echo "SIM_UDID=${EXISTING_UDID}"
  exit 0
fi

# Create the simulator
echo "Creating simulator '${SIM_NAME}' (${DEVICE_TYPE}, iOS ${RUNTIME_VERSION})..."
NEW_UDID=$(xcrun simctl create "${SIM_NAME}" "${DEVICE_TYPE_ID}" "${RUNTIME_ID}")

if [ -z "$NEW_UDID" ]; then
  echo "ERROR: Failed to create simulator." >&2
  exit 1
fi

echo "Simulator created: ${SIM_NAME}"
echo "UDID: ${NEW_UDID}"
echo "SIM_UDID=${NEW_UDID}"

# Boot the simulator briefly to complete setup
echo "Booting simulator..."
xcrun simctl boot "${NEW_UDID}"

# Wait for boot
for i in $(seq 1 30); do
  STATUS=$(xcrun simctl list devices --json | python3 -c "
import json,sys
data = json.load(sys.stdin)
for runtime_key, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('udid','') == '${NEW_UDID}':
            print(d.get('state',''))
            sys.exit(0)
" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "Booted" ]; then
    break
  fi
  sleep 2
done

echo "Simulator is ready."
echo "SIM_UDID=${NEW_UDID}"
