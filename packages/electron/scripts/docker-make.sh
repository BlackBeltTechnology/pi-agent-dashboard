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

# shellcheck disable=SC1091
source "/build/$ELECTRON_DIR/scripts/_node-version.sh"

echo "→ Building for $PLATFORM-$ARCH..."

# Safety net: ensure all source files are readable by the container.
# macOS hosts can carry extended attributes (xattr `@` flag) that
# Docker Desktop's gRPC FUSE / VirtioFS layer occasionally translates
# into broken read perms inside the container. Force `u+rwX,go+rX`
# across the project tree so subsequent reads (forge asar pack,
# bundle-server cp) never hit EACCES on a benign config file.
chmod -R u+rwX,go+rX /build/packages /build/node_modules 2>/dev/null || true
# Pre-clean any stale per-platform output dirs from prior interrupted
# runs (forge's asar step can leave files in `--w-------` mode).
if [ -d /build/packages/electron/out ]; then
  chmod -R u+rwX /build/packages/electron/out 2>/dev/null || true
  rm -rf /build/packages/electron/out/PI-Dashboard-$PLATFORM-* 2>/dev/null || true
fi

# Add Linux-specific optional deps that the host's node_modules lacks.
# The host installed on macOS/Windows so it has darwin/win32 variants
# of @rollup, @swc, etc. — not the linux-x64-gnu variants Docker needs.
#
# IMPORTANT: do NOT delete the host's existing platform packages. The
# project root is bind-mounted into Docker, so any rm inside the
# container also wipes the host's node_modules. We `npm install` the
# missing Linux packages **without going through `npm install`**, because
# `npm install --no-save` still re-evaluates `optionalDependencies` and on
# current npm versions (>= 10) wipes the host's darwin variants when run
# on the bind-mounted node_modules. See: https://github.com/npm/cli/issues/4828
#
# Strategy: use `npm pack` (registry fetch only, never touches
# node_modules) to download the tarball, then extract it into the target
# path manually. This guarantees:
#   - host's darwin/win32 packages stay intact (no npm install side effects)
#   - linux variant is added alongside
#   - subsequent host `npm run build` keeps working
_install_linux_optional() {
  local pkg="$1"  # e.g. "@rollup/rollup-linux-x64-gnu"
  local target="/build/node_modules/$pkg"
  if [ -f "$target/package.json" ]; then return 0; fi
  echo "→ Side-loading $pkg via npm pack (bypasses optional-deps re-eval)"
  local tmp
  tmp="$(mktemp -d)"
  if ! (cd "$tmp" && npm pack --silent --pack-destination=. "$pkg" >/dev/null 2>&1); then
    echo "  ⚠ npm pack failed for $pkg — build may fail later"
    rm -rf "$tmp"
    return 0  # non-fatal; let forge fail with the real error if it needs it
  fi
  local tgz
  tgz="$(ls -1 "$tmp"/*.tgz 2>/dev/null | head -1)"
  if [ -z "$tgz" ]; then
    echo "  ⚠ npm pack produced no tarball for $pkg"
    rm -rf "$tmp"
    return 0
  fi
  mkdir -p "$target"
  tar -xzf "$tgz" -C "$target" --strip-components=1
  rm -rf "$tmp"
  echo "  ✓ $pkg side-loaded at $target"
}
_install_linux_optional "@rollup/rollup-linux-$ARCH-gnu"
_install_linux_optional "@swc/core-linux-$ARCH-gnu"

# Bundle server source (no npm install — that happens here for correct native binaries)
echo "→ Bundling dashboard server source..."
node "$ELECTRON_DIR/scripts/bundle-server.mjs" --source-only

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
# npm workspaces create symlinks in node_modules/@blackbelt-technology/* that
# point to /build/packages/<name>/. These symlinks break when:
#   * extracted on Windows (target path is a Linux absolute path),
#   * walked by node's cpSync during Electron's first-run extract
#     (recursive walk hits a broken symlink, ENOTDIR on opendir).
# Iterate every entry under node_modules/@blackbelt-technology/ rather than
# a hardcoded list — prior versions missed `dashboard-plugin-runtime`, which
# server/package.json depends on. Any new workspace dep is auto-handled.
if [ -d node_modules/@blackbelt-technology ]; then
  for link in node_modules/@blackbelt-technology/*; do
    if [ -L "$link" ]; then
      target=$(readlink -f "$link")
      if [ -d "$target" ]; then
        rm "$link"
        cp -R "$target" "$link"
        echo "  ✓ Replaced symlink: $(basename "$link") → $(basename "$target")"
      else
        echo "  ⚠ Symlink target missing, leaving as-is: $link → $target"
      fi
    fi
  done
fi

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
  bash scripts/download-node.sh "$BUNDLED_NODE_VERSION" linux "$ARCH"
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
  VERSION="$BUNDLED_NODE_VERSION"
  URL="https://nodejs.org/dist/$VERSION/node-$VERSION-win-$ARCH.zip"
  echo "→ Downloading Node.js $VERSION for Windows $ARCH..."
  curl -fsSL "$URL" -o /tmp/node-win.zip
  cd /tmp && unzip -q node-win.zip && cd /build/"$ELECTRON_DIR"
  cp "/tmp/node-$VERSION-win-$ARCH/node.exe" "$NODE_DIR/"
  cp -r "/tmp/node-$VERSION-win-$ARCH/node_modules" "$NODE_DIR/"
  # Copy the npm/npx Windows shim scripts so the bundled dir is
  # invocable as `npm`/`npx` directly. Without these, `where npm`
  # returns nothing on Windows even though node.exe + node_modules/npm
  # are present. See change: embed-managed-node-runtime (task 1.1).
  cp "/tmp/node-$VERSION-win-$ARCH/npm.cmd" "$NODE_DIR/"
  cp "/tmp/node-$VERSION-win-$ARCH/npx.cmd" "$NODE_DIR/"

  # Package with Forge (package only — forge has no Windows maker we use
  # since NSIS was removed; we produce ZIP via `zip` below and an optional
  # 7-Zip SFX portable .exe via electron-builder).
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

  # 2. Portable exe (7-Zip SFX via electron-builder). Skipped when
  # ZIP_ONLY=1 — build-installer.sh --windows-zip and build-windows-zip.sh
  # --no-portable both set this. ZIP is always produced above.
  if [ "${ZIP_ONLY:-0}" = "1" ]; then
    echo "→ Skipping portable exe (ZIP_ONLY=1)"
  else
    echo "→ Building portable exe..."
    # Disable code-signing: no cert configured, but electron-builder otherwise
    # auto-discovers system certs and runs osslsigncode on the 169 MB SFX.
    # See: signtoolOptions:null in the inline config below + these env vars.
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    export WIN_CSC_LINK=
    export CSC_LINK=
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
    "target": ["portable"],
    "signtoolOptions": null
  }
}
EOF
) || echo "  ⚠ Portable build failed (non-fatal)"
  fi

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
