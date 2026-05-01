#!/usr/bin/env bash
#
# Runs inside the Docker container to build Electron installers.
# Called by Dockerfile.build ENTRYPOINT.
#
# Usage: docker-make.sh <platform> <arch>
#   platform: linux, win32
#   arch: x64, arm64
#
set -euo pipefail

PLATFORM="${1:-linux}"
ARCH="${2:-x64}"
ELECTRON_DIR="packages/electron"

echo "→ Building for $PLATFORM-$ARCH..."

# Bundle server source (no npm install — that happens here for correct native binaries)
echo "→ Bundling dashboard server source..."
bash "$ELECTRON_DIR/scripts/bundle-server.sh" --source-only

# Bundle offline npm cache for first-run (opt-in via BUNDLE_OFFLINE_PACKAGES=1).
# Runs BEFORE electron-forge package/make so the resource is picked up by extraResource.
if [ "${BUNDLE_OFFLINE_PACKAGES:-0}" = "1" ]; then
  echo "→ Bundling offline packages for $PLATFORM-$ARCH..."
  node "$ELECTRON_DIR/scripts/bundle-offline-packages.mjs" --platform="$PLATFORM-$ARCH"
else
  echo "→ Skipping offline package bundle (BUNDLE_OFFLINE_PACKAGES!=1)"
fi

# Install deps inside Docker to get correct native modules for the target platform
echo "→ Installing server dependencies..."
cd "$ELECTRON_DIR/resources/server"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5 || true

# Replace workspace symlinks with actual copies.
# npm workspaces create symlinks in node_modules/ pointing to packages/.
# These symlinks break when extracted from archives (7z portable, asar).
for link in node_modules/@blackbelt-technology/pi-dashboard-shared \
           node_modules/@blackbelt-technology/pi-dashboard-extension \
           node_modules/@blackbelt-technology/pi-dashboard-server; do
  if [ -L "$link" ]; then
    target=$(readlink -f "$link")
    rm "$link"
    cp -R "$target" "$link"
    echo "  ✓ Replaced symlink: $(basename $link)"
  fi
done

# Platform-specific native module handling
if [ "$PLATFORM" = "linux" ]; then
  # Linux: copy built-from-source pty.node into prebuilds, remove other platforms
  BUILT_PTY="node_modules/node-pty/build/Release/pty.node"
  if [ -f "$BUILT_PTY" ]; then
    PREBUILD_DIR="node_modules/node-pty/prebuilds/linux-$ARCH"
    mkdir -p "$PREBUILD_DIR"
    cp "$BUILT_PTY" "$PREBUILD_DIR/pty.node"
    echo "  ✓ Copied pty.node to prebuilds/linux-$ARCH"
  fi
  rm -rf node_modules/node-pty/prebuilds/darwin-*
  rm -rf node_modules/node-pty/prebuilds/win32-*
elif [ "$PLATFORM" = "win32" ]; then
  # Windows: keep win32 prebuilds for target arch, remove others
  if [ -d "node_modules/node-pty/prebuilds/win32-$ARCH" ]; then
    echo "  ✓ Keeping win32-$ARCH prebuilds for node-pty"
  else
    echo "  ⚠ No win32-$ARCH prebuilds found for node-pty (terminal may not work)"
  fi
  rm -rf node_modules/node-pty/prebuilds/darwin-*
  rm -rf node_modules/node-pty/prebuilds/linux-*
  # Remove prebuilds for other Windows arches
  for d in node_modules/node-pty/prebuilds/win32-*; do
    [ -d "$d" ] && [[ "$d" != *"win32-$ARCH" ]] && rm -rf "$d"
  done
  rm -rf node_modules/node-pty/build  # remove Linux build artifacts
fi

cd /build

# ── Linux build via Forge ────────────────────────────────────────

if [ "$PLATFORM" = "linux" ]; then
  cd "$ELECTRON_DIR"
  bash scripts/download-node.sh v22.12.0 linux "$ARCH"
  cd /build

  cd "$ELECTRON_DIR"
  cd /build/packages/electron
  ../../node_modules/.bin/electron-forge make --platform linux --arch "$ARCH"

  echo ""
  echo "✓ Build complete for linux-$ARCH"
  echo ""
  echo "Installers:"
  find out/make -type f \( -name "*.deb" -o -name "*.AppImage" \) 2>/dev/null | while read -r f; do
    SIZE=$(du -h "$f" | cut -f1)
    echo "  $SIZE  $f"
  done
  exit 0
fi

# ── Windows build via electron-builder (cross-compilation) ───────

if [ "$PLATFORM" = "win32" ]; then
  cd "$ELECTRON_DIR"

  # Download Windows Node.js for bundling (matching target arch)
  NODE_DIR="resources/node"
  mkdir -p "$NODE_DIR"
  VERSION="v22.12.0"
  URL="https://nodejs.org/dist/$VERSION/node-$VERSION-win-$ARCH.zip"
  echo "→ Downloading Node.js $VERSION for Windows $ARCH..."
  curl -fsSL "$URL" -o /tmp/node-win.zip
  cd /tmp && unzip -q node-win.zip && cd /build/"$ELECTRON_DIR"
  cp "/tmp/node-$VERSION-win-$ARCH/node.exe" "$NODE_DIR/"
  cp -r "/tmp/node-$VERSION-win-$ARCH/node_modules" "$NODE_DIR/"

  # Package with Forge (package only — skip makers, NSIS can't run on Linux)
  cd /build/packages/electron
  ../../node_modules/.bin/electron-forge package --platform win32 --arch "$ARCH"

  # Debug: show output directory
  echo "→ Forge package output:"
  ls -la out/ 2>/dev/null || echo "  (no out/ directory)"
  PACKAGED_DIR="out/PI-Dashboard-win32-$ARCH"
  if [ ! -d "$PACKAGED_DIR" ]; then
    echo "❌ Expected packaged dir not found: $PACKAGED_DIR"
    echo "   Available dirs:"
    find out -maxdepth 1 -type d 2>/dev/null
    exit 1
  fi
  echo "  ✓ Found: $PACKAGED_DIR"
  ls "$PACKAGED_DIR/" | head -10

  # 1. ZIP archive (always works)
  echo "→ Creating ZIP archive..."
  ZIP_DIR="out/make/zip/$ARCH"
  mkdir -p "$ZIP_DIR"
  ZIP_NAME="PI-Dashboard-$ARCH.zip"
  cd out
  zip -r -q "../out/make/zip/$ARCH/$ZIP_NAME" "PI-Dashboard-win32-$ARCH/"
  cd /build/packages/electron

  # 2. Portable exe (self-extracting)
  echo "→ Building portable exe..."
  npx electron-builder --win portable --$ARCH \
    --prepackaged "$PACKAGED_DIR" \
    --config <(cat <<EOF
{
  "appId": "com.blackbelt-technology.pi-dashboard",
  "productName": "PI Dashboard",
  "executableName": "pi-dashboard",
  "directories": { "output": "out/make/portable/$ARCH" },
  "portable": { "artifactName": "PI-Dashboard-portable.exe" },
  "win": {
    "icon": "resources/icon.ico",
    "target": ["portable"]
  }
}
EOF
) || echo "  ⚠ Portable build failed (non-fatal)"

  echo ""
  echo "✓ Build complete for win32-$ARCH"
  echo ""
  echo "Output:"
  find out/make -type f \( -name "*.zip" -o -name "*.exe" \) 2>/dev/null | while read -r f; do
    SIZE=$(du -h "$f" | cut -f1)
    echo "  $SIZE  $f"
  done
  exit 0
fi

echo "❌ Unsupported platform: $PLATFORM (use 'linux' or 'win32')"
exit 1
