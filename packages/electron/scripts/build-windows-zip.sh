#!/usr/bin/env bash
# =============================================================================
# build-windows-zip.sh — Build Windows ZIP (and portable .exe) from source
#
# Full pipeline:
#   1. Build web client (Vite)
#   2. Bundle server source → resources/server/
#   3. Install server npm deps for Windows target (native modules)
#   4. Download Windows Node.js → resources/node/
#   5. electron-forge package --platform win32
#   6. Zip packaged output → out/make/zip/x64/PI-Dashboard-win32-x64.zip
#   7. electron-builder portable → out/make/portable/x64/PI-Dashboard-portable.exe
#
# Platform behaviour:
#   Windows (native)  — steps run directly; forge + PowerShell do the zip
#   macOS / Linux     — cross-compile inside Docker (same image CI uses)
#
# Usage:
#   ./build-windows-zip.sh                  # x64 (default)
#   ./build-windows-zip.sh --arch arm64     # arm64
#   ./build-windows-zip.sh --skip-client    # skip step 1 (already built)
#   ./build-windows-zip.sh --no-portable    # skip portable .exe (step 7)
#   ./build-windows-zip.sh --skip-docker    # macOS/Linux: skip Docker, manual steps only
#
# Output: packages/electron/out/make/
#   zip/x64/PI-Dashboard-win32-x64.zip
#   portable/x64/PI-Dashboard-portable.exe  (unless --no-portable)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_node-version.sh"
NODE_VERSION="$BUNDLED_NODE_VERSION"
ARCH="x64"
SKIP_CLIENT=false
NO_PORTABLE=false
SKIP_DOCKER=false
DOCKER_IMAGE="pi-dashboard-electron-builder"

# ── Argument parsing ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)        ARCH="$2"; shift 2 ;;
    --skip-client) SKIP_CLIENT=true; shift ;;
    --no-portable) NO_PORTABLE=true; shift ;;
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --help|-h)
      sed -n '/^# Usage/,/^# Output/p' "$0" | sed 's/^# \{0,2\}//'
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Detect host platform ──────────────────────────────────────────────────────

HOST_PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$HOST_PLATFORM" in
  darwin)  HOST_OS="macOS" ;;
  linux)   HOST_OS="Linux" ;;
  mingw*|msys*|cygwin*) HOST_PLATFORM="win32"; HOST_OS="Windows" ;;
  *) echo "❌ Unsupported host: $HOST_PLATFORM"; exit 1 ;;
esac

echo "════════════════════════════════════════════════════════"
echo "  PI Dashboard — Windows ZIP Builder"
echo "  Host: $HOST_OS   Target: win32-$ARCH"
echo "════════════════════════════════════════════════════════"
echo ""

# =============================================================================
# Defensive cleanup
# =============================================================================
# Prior interrupted runs may leave files with restrictive perms (e.g.
# `--w-------` mode from a half-written forge `package` step) or stale
# packaged dirs that block re-packaging. Make everything writable, then
# remove the stale per-platform output dirs so forge can repackage cleanly.
if [ -d "$ELECTRON_DIR/out" ]; then
  chmod -R u+rwX "$ELECTRON_DIR/out" 2>/dev/null || true
  rm -rf "$ELECTRON_DIR/out/PI-Dashboard-win32-"* 2>/dev/null || true
fi

# NOTE: macOS xattr stripping deliberately omitted on the Docker path.
# Docker is invoked WITHOUT a bind-mount (see below), so the FUSE/VirtioFS
# layer that mis-translates xattrs into EACCES is never in play.

# =============================================================================
# STEP 1 — Build web client (Vite) — host-only path
# =============================================================================
# On the native-Windows path we build on the host. On the Docker path the
# Dockerfile's `RUN npm run build` rebuilds the client inside the image, so
# a host-side build would be discarded (no bind-mount).

if [ "$HOST_PLATFORM" = "win32" ]; then
  if [ "$SKIP_CLIENT" = false ]; then
    echo "▶ Step 1/7 — Building web client..."
    cd "$PROJECT_DIR"
    npm run build
    echo "✓ Web client built"
  else
    echo "– Step 1/7 — Skipping web client build (--skip-client)"
  fi
fi

# =============================================================================
# Windows-native path vs. Cross-compile (Docker) path
# =============================================================================

if [ "$HOST_PLATFORM" = "win32" ]; then

  # ===========================================================================
  # NATIVE WINDOWS PATH
  # All steps run directly on the Windows host.
  # ===========================================================================

  echo ""
  echo "  Running native Windows build pipeline..."
  echo ""

  # ── Step 2 — Bundle server source ────────────────────────────────────────
  echo "▶ Step 2/7 — Bundling server source..."
  cd "$PROJECT_DIR"
  node packages/electron/scripts/bundle-server.mjs
  echo "✓ Server bundled"

  # ── Step 3 — Install server deps for Windows ─────────────────────────────
  echo ""
  echo "▶ Step 3/7 — Installing server dependencies (Windows native modules)..."
  cd "$ELECTRON_DIR/resources/server"
  npm install --omit=dev --no-audit --no-fund

  # Keep only win32 node-pty prebuilds; strip darwin + linux
  if [ -d node_modules/node-pty/prebuilds ]; then
    echo "  → Pruning node-pty prebuilds for win32-$ARCH..."
    for d in node_modules/node-pty/prebuilds/darwin-* \
              node_modules/node-pty/prebuilds/linux-*; do
      [ -d "$d" ] && rm -rf "$d"
    done
    for d in node_modules/node-pty/prebuilds/win32-*; do
      [ -d "$d" ] && [[ "$d" != *"win32-$ARCH" ]] && rm -rf "$d"
    done
  fi
  echo "✓ Server dependencies installed"

  # ── Step 4 — Download Windows Node.js ────────────────────────────────────
  echo ""
  echo "▶ Step 4/7 — Downloading bundled Node.js $NODE_VERSION (win32-$ARCH)..."
  cd "$ELECTRON_DIR"
  NODE_DIR="resources/node"
  mkdir -p "$NODE_DIR"
  NODE_ZIP_URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-$ARCH.zip"
  NODE_TMP="/tmp/node-win-$ARCH.zip"
  curl -fsSL "$NODE_ZIP_URL" -o "$NODE_TMP"
  cd /tmp && unzip -q "$NODE_TMP" && cd "$ELECTRON_DIR"
  cp "/tmp/node-$NODE_VERSION-win-$ARCH/node.exe"   "$NODE_DIR/"
  cp -r "/tmp/node-$NODE_VERSION-win-$ARCH/node_modules" "$NODE_DIR/"
  cp "/tmp/node-$NODE_VERSION-win-$ARCH/npm.cmd"    "$NODE_DIR/" 2>/dev/null || true
  cp "/tmp/node-$NODE_VERSION-win-$ARCH/npx.cmd"    "$NODE_DIR/" 2>/dev/null || true
  echo "✓ Node.js bundled"

  # ── Step 5 — electron-forge package ──────────────────────────────────────
  echo ""
  echo "▶ Step 5/7 — Packaging with electron-forge (win32-$ARCH)..."
  cd "$ELECTRON_DIR"
  ../../node_modules/.bin/electron-forge package --platform win32 --arch "$ARCH"
  echo "✓ Packaged"

  # ── Step 6 — Create ZIP ───────────────────────────────────────────────────
  echo ""
  echo "▶ Step 6/7 — Creating ZIP archive..."
  PACKAGED_DIR="$ELECTRON_DIR/out/PI-Dashboard-win32-$ARCH"
  ZIP_DIR="$ELECTRON_DIR/out/make/zip/$ARCH"
  mkdir -p "$ZIP_DIR"
  cd "$ELECTRON_DIR/out"
  zip -r -q "$ZIP_DIR/PI-Dashboard-win32-$ARCH.zip" "PI-Dashboard-win32-$ARCH/"
  echo "✓ ZIP created: $ZIP_DIR/PI-Dashboard-win32-$ARCH.zip"

  # ── Step 7 — Portable .exe ───────────────────────────────────────────────
  if [ "$NO_PORTABLE" = false ]; then
    echo ""
    echo "▶ Step 7/7 — Building portable .exe (7-Zip SFX)..."
    cd "$ELECTRON_DIR"
    # Disable code-signing entirely: no cert is configured, but electron-builder
    # auto-discovers system certs by default and runs osslsigncode (slow PE rewrite
    # of the 169 MB SFX). CSC_IDENTITY_AUTO_DISCOVERY=false short-circuits that.
    CSC_IDENTITY_AUTO_DISCOVERY=false WIN_CSC_LINK= CSC_LINK= \
    npx electron-builder --win portable --"$ARCH" \
      --prepackaged "out/PI-Dashboard-win32-$ARCH" \
      --config.appId=com.blackbelt-technology.pi-dashboard \
      --config.productName="PI Dashboard" \
      --config.directories.output="out/make/portable/$ARCH" \
      --config.portable.artifactName="PI-Dashboard-portable.exe" \
      --config.win.icon=resources/icon.ico
    echo "✓ Portable .exe built"
  else
    echo "– Step 7/7 — Skipping portable .exe (--no-portable)"
  fi

else

  # ===========================================================================
  # CROSS-COMPILE PATH (macOS / Linux)
  # Steps 2–7 run inside Docker. Step 1 (web client) already ran above
  # and the dist/ output is mounted into the container.
  # ===========================================================================

  if [ "$SKIP_DOCKER" = true ]; then
    echo ""
    echo "❌ Cross-compile from $HOST_OS requires Docker."
    echo "   Remove --skip-docker, or run on a Windows host for a native build."
    exit 1
  fi

  # ── Check Docker ────────────────────────────────────────────────────────────
  if ! command -v docker &>/dev/null; then
    echo "❌ Docker is required for cross-compilation on $HOST_OS."
    echo "   Install: https://docs.docker.com/get-docker/"
    exit 1
  fi
  if ! docker info &>/dev/null 2>&1; then
    echo "❌ Docker daemon is not running."
    exit 1
  fi
  echo "✓ Docker available"

  # ── Build Docker image (cached) ──────────────────────────────────────────
  # Source tree is bind-mounted at runtime, so the image only needs build
  # tools + node_modules — not a per-build source snapshot. Cache OK.
  # `--platform linux/amd64` is mandatory: docker-make.sh's optional-deps
  # heuristic installs `@rollup/rollup-linux-$ARCH-gnu` where $ARCH is the
  # Windows target (x64). On Apple Silicon hosts, an unpinned container
  # would default to linux/arm64 and forge would fail looking for
  # rollup-linux-arm64-gnu (which we never install).
  if ! docker image inspect "$DOCKER_IMAGE" &>/dev/null 2>&1; then
    echo ""
    echo "▶ Building Docker image ($DOCKER_IMAGE)..."
    docker build --platform linux/amd64 \
      --build-arg "NODE_BUILD_IMAGE=node:${BUNDLED_NODE_MAJOR}-bookworm-slim" \
      -t "$DOCKER_IMAGE" -f "$SCRIPT_DIR/Dockerfile.build" "$PROJECT_DIR"
    echo "✓ Docker image built"
  else
    echo "✓ Docker image already present"
  fi

  # ── Steps 2–7: Run inside Docker ────────────────────────────────────────
  # The docker-make.sh entrypoint handles:
  #   2. bundle-server.mjs --source-only
  #   3. npm install (Windows-targeted native modules)
  #   4. Download Windows Node.js
  #   5. electron-forge package --platform win32
  #   6. zip
  #   7. electron-builder portable (unless ZIP_ONLY=1)
  #
  # Mount strategy:
  #   * Source tree bind-mounted at /build (fast iteration, avoids copying
  #     the multi-GB monorepo+node_modules into Docker's writable layer —
  #     a `COPY . .`-only path otherwise hits ENOSPC on Docker Desktop's
  #     default VM disk allocation).
  #   * Anonymous volume shadows `out/` only. The original EACCES (forge's
  #     "Finalizing package" step) only fires under out/PI-Dashboard-*/
  #     because that's where electron-packager does its heavy
  #     read-after-write dance through Docker Desktop's gRPC FUSE /
  #     VirtioFS layer. Anonymous volume puts those writes on the
  #     container's native overlayfs and dodges the FUSE bug. The source
  #     `resources/server/` is left bind-mounted so bundle-server.mjs's
  #     rmSync(SERVER_BUNDLE) doesn't fight a mountpoint (EBUSY).
  # Artifacts are extracted via `docker cp` from the volume mount point.
  echo ""
  echo "▶ Steps 2–7 — Running inside Docker (win32-$ARCH)..."
  echo ""

  ZIP_ONLY_FLAG="0"
  [ "$NO_PORTABLE" = true ] && ZIP_ONLY_FLAG="1"

  CONTAINER_NAME="pi-dashboard-electron-build-$$"
  RUN_RC=0
  # Dockerfile.build ENTRYPOINT is `bash docker-make.sh` — pass only positional args.
  # `|| RUN_RC=$?` keeps `set -e` from aborting before we extract artifacts.
  docker run \
    --platform linux/amd64 \
    --name "$CONTAINER_NAME" \
    -v "$PROJECT_DIR:/build" \
    -v /build/packages/electron/out \
    -w /build \
    -e "ZIP_ONLY=$ZIP_ONLY_FLAG" \
    "$DOCKER_IMAGE" \
    win32 "$ARCH" || RUN_RC=$?

  # Always extract whatever artifacts exist (some makers may have succeeded
  # even if a later one failed) and remove the container.
  mkdir -p "$ELECTRON_DIR/out/make"
  docker cp "$CONTAINER_NAME:/build/packages/electron/out/make/." "$ELECTRON_DIR/out/make/" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

  if [ "$RUN_RC" -ne 0 ]; then
    echo "❌ Docker build exited with status $RUN_RC"
    exit "$RUN_RC"
  fi

  echo ""
  echo "✓ Docker build complete"

fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✓ Windows ZIP build complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Artifacts in packages/electron/out/make/:"
find "$ELECTRON_DIR/out/make" -type f \( -name "*.zip" -o -name "*.exe" \) 2>/dev/null \
  | sort \
  | while read -r f; do
      SIZE=$(du -h "$f" | cut -f1)
      echo "  $SIZE  ${f#$PROJECT_DIR/}"
    done
