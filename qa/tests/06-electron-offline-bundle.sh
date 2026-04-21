#!/usr/bin/env bash
# Test: the packaged Electron app contains the offline package bundle.
# Expected invocation context: running inside or with a mounted extracted
# copy of the packaged app (macOS .app, Linux AppImage extract, Windows
# unzipped portable build). Pass the app's Resources path as $1.
#
# Exit 0 if bundle is present and well-formed, 1 otherwise.

set -euo pipefail

APP_RESOURCES="${1:-}"
if [ -z "$APP_RESOURCES" ]; then
  echo "usage: $0 <app-resources-dir>" >&2
  echo "  macOS:   .../PI-Dashboard.app/Contents/Resources" >&2
  echo "  Linux:   squashfs-root/resources (AppImage) or /opt/PI-Dashboard/resources (DEB)" >&2
  echo "  Windows: <install>/resources" >&2
  exit 2
fi

DIR="$APP_RESOURCES/offline-packages"
MANIFEST="$DIR/manifest.json"
TARBALL="$DIR/npm-cache.tar.gz"

echo "=== Test: packaged app contains offline-packages bundle ==="
echo "Resources: $APP_RESOURCES"

if [ ! -d "$DIR" ]; then
  echo "FAIL: $DIR missing"
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: $MANIFEST missing"
  exit 1
fi
if [ ! -f "$TARBALL" ]; then
  echo "FAIL: $TARBALL missing"
  exit 1
fi

# Basic manifest sanity (use fs.readFile — require() needs absolute or ./ paths)
node -e "
  const fs = require('node:fs');
  const m = JSON.parse(fs.readFileSync('$MANIFEST','utf-8'));
  if (!m.sha256 || !/^[0-9a-f]{64}\$/i.test(m.sha256)) { console.error('bad sha256'); process.exit(1); }
  if (!Array.isArray(m.packages) || m.packages.length === 0) { console.error('no packages'); process.exit(1); }
  if (!m.targetPlatform) { console.error('no targetPlatform'); process.exit(1); }
  console.log('manifest ok: ' + m.targetPlatform + ' (' + m.packages.length + ' pins)');
"

# Verify SHA-256 matches manifest
EXPECTED=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('$MANIFEST','utf-8')).sha256)")
if command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TARBALL" | cut -d' ' -f1)
else
  echo "WARN: no shasum utility available, skipping checksum verification"
  exit 0
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "FAIL: sha256 mismatch"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 1
fi

echo "PASS: offline bundle present and valid (sha256: ${EXPECTED:0:12}…)"
