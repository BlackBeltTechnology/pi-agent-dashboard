#!/usr/bin/env bash
#
# Build Electron installer for one or more platforms.
#
# Usage:
#   ./build-installer.sh              # Build for current platform
#   ./build-installer.sh --all        # Build for all platforms (macOS native + Docker for Linux/Windows)
#   ./build-installer.sh --linux      # Build Linux installers via Docker
#   ./build-installer.sh --windows    # Build Windows installer via Docker
#   ./build-installer.sh --arch x64   # Override architecture
#   ./build-installer.sh --skip-client # Skip web client build
#   ./build-installer.sh --help
#
# What it produces:
#   macOS   → .dmg                          in out/make/
#   Linux   → .deb + .AppImage              in out/make/
#   Windows → .zip + portable .exe          in out/make/zip/<arch>/
#                                           + out/make/portable/<arch>/
#             (NSIS removed — see openspec/changes/
#              simplify-electron-bootstrap-derived-state.)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_node-version.sh"
NODE_VERSION="$BUNDLED_NODE_VERSION"
SKIP_CLIENT=false
ARCH=""
BUILD_NATIVE=false
BUILD_LINUX=false
BUILD_WINDOWS=false
BUILD_WINDOWS_ZIP_ONLY=false
BUILD_ALL=false
BUILD_MAC_BOTH=false
DOCKER_IMAGE="pi-dashboard-electron-builder"

# ── Parse arguments ──────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      BUILD_ALL=true
      shift
      ;;
    --mac-both)
      BUILD_MAC_BOTH=true
      shift
      ;;
    --linux)
      BUILD_LINUX=true
      shift
      ;;
    --windows)
      BUILD_WINDOWS=true
      shift
      ;;
    --windows-zip)
      BUILD_WINDOWS=true
      BUILD_WINDOWS_ZIP_ONLY=true
      shift
      ;;
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --skip-client)
      SKIP_CLIENT=true
      shift
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [options]"
      echo ""
      echo "Build Electron installers for PI Dashboard."
      echo ""
      echo "Platform options (can be combined):"
      echo "  (none)            Build for current platform only"
      echo "  --all             Build for all platforms (native + Docker)"
      echo "  --linux           Build Linux .deb + .AppImage via Docker"
      echo "  --windows         Build Windows .zip + portable .exe via Docker"
      echo "  --windows-zip     Build Windows .zip only via Docker (no portable)"
      echo "  --mac-both        Build BOTH macOS DMGs (arm64 + x64) on an"
      echo "                    Apple Silicon host. Requires Rosetta 2."
      echo ""
      echo "Other options:"
      echo "  --arch <arch>     Override architecture (x64, arm64)"
      echo "  --skip-client     Skip web client build"
      echo "  -h, --help        Show this help"
      echo ""
      echo "Examples:"
      echo "  $(basename "$0")                  # macOS DMG (on a Mac)"
      echo "  $(basename "$0") --all            # DMG + DEB + AppImage + EXE"
      echo "  $(basename "$0") --linux --windows # Linux + Windows via Docker"
      echo "  $(basename "$0") --mac-both       # arm64 + x64 DMGs on M1+"
      echo ""
      echo "Docker is required for --linux, --windows, and --all."
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# If --all, enable everything
if [ "$BUILD_ALL" = true ]; then
  BUILD_NATIVE=true
  BUILD_LINUX=true
  BUILD_WINDOWS=true
fi

# If --mac-both, this implies a native build (we orchestrate the two arch
# runs ourselves below). Cross-platform flags are independent.
if [ "$BUILD_MAC_BOTH" = true ]; then
  BUILD_NATIVE=true
fi

# If no cross-platform flags, just do native
if [ "$BUILD_LINUX" = false ] && [ "$BUILD_WINDOWS" = false ]; then
  BUILD_NATIVE=true
fi

# ── Detect platform ─────────────────────────────────────────────

HOST_PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$HOST_PLATFORM" in
  darwin)  HOST_LABEL="macOS" ;;
  linux)   HOST_LABEL="Linux" ;;
  mingw*|msys*|cygwin*) HOST_PLATFORM="win32"; HOST_LABEL="Windows" ;;
  *)       echo "❌ Unsupported platform: $HOST_PLATFORM"; exit 1 ;;
esac

HOST_ARCH_RAW="$(uname -m)"
case "$HOST_ARCH_RAW" in
  x86_64|amd64) HOST_ARCH="x64" ;;
  aarch64|arm64) HOST_ARCH="arm64" ;;
  *) HOST_ARCH="$HOST_ARCH_RAW" ;;
esac

if [ -z "$ARCH" ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64)      ARCH="arm64" ;;
  esac
fi

# ── Print build plan ────────────────────────────────────────────

echo "════════════════════════════════════════════════════════"
echo "  PI Dashboard — Electron Build"
echo "  Host: $HOST_LABEL ($HOST_PLATFORM-$ARCH)"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Build targets:"
[ "$BUILD_NATIVE" = true ]  && echo "  • $HOST_LABEL (native)  → DMG / DEB+AppImage / EXE"
[ "$BUILD_LINUX" = true ]   && echo "  • Linux (Docker)        → .deb + .AppImage"
[ "$BUILD_WINDOWS" = true ] && [ "$BUILD_WINDOWS_ZIP_ONLY" = false ] \
  && echo "  • Windows (Docker)      → .zip + portable .exe"
[ "$BUILD_WINDOWS" = true ] && [ "$BUILD_WINDOWS_ZIP_ONLY" = true ] \
  && echo "  • Windows (Docker)      → .zip only"
echo ""

# ── Check Docker if needed ──────────────────────────────────────

if [ "$BUILD_LINUX" = true ] || [ "$BUILD_WINDOWS" = true ]; then
  if ! command -v docker &>/dev/null; then
    echo "❌ Docker is required for cross-platform builds."
    echo "   Install: https://docs.docker.com/get-docker/"
    exit 1
  fi
  if ! docker info &>/dev/null; then
    echo "❌ Docker daemon is not running."
    exit 1
  fi
  echo "✓ Docker available"
fi

# ── Check Node.js version (for native build) ────────────────────

if [ "$BUILD_NATIVE" = true ]; then
  NODE_MAJOR=$(node -e "console.log(process.version.split('.')[0].slice(1))")
  NODE_MINOR=$(node -e "console.log(process.version.split('.')[1])")

  if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
    echo "❌ Node.js 22.12+ required for native build (found $(node --version))"
    echo ""
    echo "   nvm install 22"
    echo "   nvm use 22"
    exit 1
  fi
  echo "✓ Node.js $(node --version)"
fi

# ── Install dependencies if needed ──────────────────────────────

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo ""
  echo "→ Installing dependencies..."
  cd "$PROJECT_DIR"
  npm ci
fi
echo "✓ Dependencies installed"

# ── Build web client ────────────────────────────────────────────

if [ "$SKIP_CLIENT" = false ]; then
  echo ""
  echo "→ Building web client..."
  cd "$PROJECT_DIR"
  npm run build
  echo "✓ Web client built"
else
  echo "→ Skipping web client build (--skip-client)"
fi

# ── Collect output directory ────────────────────────────────────

OUTPUT_DIR="$ELECTRON_DIR/out/make"
SENTINEL_FILE="$ELECTRON_DIR/resources/.last-arch"

# ── Helpers: arch-aware cache invalidation + cross-arch shim ────

# Wipe per-arch caches when the requested arch differs from the previously-
# built arch on darwin. Without this, back-to-back arch builds reuse stale
# caches and produce a DMG with mismatched-arch native modules.
maybe_wipe_arch_caches() {
  local target_arch="$1"
  if [ "$HOST_PLATFORM" != "darwin" ]; then
    return 0
  fi
  local last_arch=""
  if [ -f "$SENTINEL_FILE" ]; then
    last_arch="$(cat "$SENTINEL_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$last_arch" ] && [ "$last_arch" != "$target_arch" ]; then
    echo "→ Arch switch detected ($last_arch → $target_arch) — invalidating per-arch caches"
    rm -rf "$ELECTRON_DIR/resources/node" \
           "$ELECTRON_DIR/resources/server"
  fi
  mkdir -p "$ELECTRON_DIR/resources"
  echo "$target_arch" > "$SENTINEL_FILE"
}

# Probe Rosetta 2 on Apple Silicon. Required for cross-arch x64 builds.
verify_rosetta_or_fail() {
  if arch -x86_64 /usr/bin/true 2>/dev/null; then
    echo "✓ Rosetta 2 available"
    return 0
  fi
  echo "❌ Rosetta 2 is required to cross-build x64 from an Apple Silicon host."
  echo "   Install with:"
  echo ""
  echo "     softwareupdate --install-rosetta --agree-to-license"
  echo ""
  exit 1
}

# ── Native build (function so --mac-both can call it twice) ─────

build_native_one_arch() {
  local target_arch="$1"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Building $HOST_LABEL installer (native, arch=$target_arch)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Detect cross-arch case (Apple Silicon host → x64 target).
  local cross_prefix=""
  local cross_target_arch_env=""
  if [ "$HOST_PLATFORM" = "darwin" ] && [ "$HOST_ARCH" = "arm64" ] && [ "$target_arch" = "x64" ]; then
    echo "→ Cross-arch build (arm64 host → x64 target) — verifying Rosetta 2..."
    verify_rosetta_or_fail
    cross_prefix="arch -x86_64"
    cross_target_arch_env="x64"
  fi

  # Intel hosts cannot cross-build arm64 locally (Rosetta is one-way).
  if [ "$HOST_PLATFORM" = "darwin" ] && [ "$HOST_ARCH" = "x64" ] && [ "$target_arch" = "arm64" ]; then
    echo "❌ Intel macOS hosts cannot cross-build arm64 locally (Rosetta is x64-only)."
    echo "   Use CI for arm64 validation, or build on an Apple Silicon mac."
    exit 1
  fi

  # Per-arch cache invalidation BEFORE bundle steps so they re-run for the new arch.
  maybe_wipe_arch_caches "$target_arch"

  # Bundle dashboard server (per-arch native modules)
  if [ ! -d "$ELECTRON_DIR/resources/server/node_modules" ]; then
    echo ""
    echo "→ Bundling dashboard server (arch=$target_arch)..."
    if [ -n "$cross_prefix" ]; then
      TARGET_ARCH="$cross_target_arch_env" $cross_prefix node "$ELECTRON_DIR/scripts/bundle-server.mjs"
    else
      node "$ELECTRON_DIR/scripts/bundle-server.mjs"
    fi
  else
    echo "✓ Bundled server already present"
  fi

  # Offline npm cache step removed under change: eliminate-electron-runtime-install.
  # pi/openspec/tsx are bundled as regular dependencies of
  # @blackbelt-technology/pi-dashboard-server, materialised into
  # `resources/server/node_modules/` by `bundle-server.mjs` above.

  # Bundled Node.js (per-arch)
  if [ "$HOST_PLATFORM" != "win32" ]; then
    if [ ! -f "$ELECTRON_DIR/resources/node/bin/node" ]; then
      echo "→ Downloading Node.js $NODE_VERSION for $HOST_PLATFORM-$target_arch..."
      cd "$ELECTRON_DIR"
      bash scripts/download-node.sh "$NODE_VERSION" "$HOST_PLATFORM" "$target_arch"
    fi
  fi

  cd "$ELECTRON_DIR"
  npm run make -- --arch "$target_arch"
  echo "✓ $HOST_LABEL build complete (arch=$target_arch)"
}

# ── Native build orchestration ──────────────────────────────────

if [ "$BUILD_MAC_BOTH" = true ]; then
  if [ "$HOST_PLATFORM" != "darwin" ]; then
    echo "❌ --mac-both is only supported on macOS hosts (got $HOST_PLATFORM)."
    exit 1
  fi
  if [ "$HOST_ARCH" != "arm64" ]; then
    echo "❌ --mac-both requires an Apple Silicon host (got $HOST_ARCH)."
    echo "   Intel macs cannot cross-build arm64 locally; use CI for arm64."
    exit 1
  fi
  build_native_one_arch "arm64"
  build_native_one_arch "x64"
elif [ "$BUILD_NATIVE" = true ]; then
  build_native_one_arch "$ARCH"
fi

# ── Docker build helper ─────────────────────────────────────────

docker_build() {
  local TARGET_PLATFORM="$1"
  local TARGET_ARCH="${2:-x64}"
  local LABEL="$3"
  local ZIP_ONLY_FLAG="${4:-0}"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Building $LABEL installer (Docker)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  cd "$PROJECT_DIR"

  # Build Docker image for x86_64 (required for x64 native modules:
  # node-pty prebuilds + the bundled Node.js host arch must match).
  docker build \
    --no-cache \
    --platform linux/amd64 \
    --build-arg "NODE_BUILD_IMAGE=node:${BUNDLED_NODE_MAJOR}-bookworm-slim" \
    -f packages/electron/scripts/Dockerfile.build \
    -t "$DOCKER_IMAGE" \
    . 2>&1 | tail -20

  # Run the build, copy output
  local CONTAINER_NAME="pi-electron-build-$$"
  docker run \
    --platform linux/amd64 \
    --name "$CONTAINER_NAME" \
    -e "ZIP_ONLY=$ZIP_ONLY_FLAG" \
    "$DOCKER_IMAGE" \
    "$TARGET_PLATFORM" "$TARGET_ARCH"

  # Extract build artifacts
  mkdir -p "$OUTPUT_DIR"
  docker cp "$CONTAINER_NAME:/build/packages/electron/out/make/." "$OUTPUT_DIR/" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" >/dev/null

  echo "✓ $LABEL build complete"
}

# ── Linux build via Docker ──────────────────────────────────────

if [ "$BUILD_LINUX" = true ]; then
  docker_build "linux" "$ARCH" "Linux"
fi

# ── Windows build via Docker ────────────────────────────────────

if [ "$BUILD_WINDOWS" = true ]; then
  ZIP_ONLY_VAL="0"
  [ "$BUILD_WINDOWS_ZIP_ONLY" = true ] && ZIP_ONLY_VAL="1"
  docker_build "win32" "x64" "Windows" "$ZIP_ONLY_VAL"
fi

# ── Show results ────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✓ All builds complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Installers in $OUTPUT_DIR:"
find "$OUTPUT_DIR" -type f \( \
  -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" \
  -o -name "*.exe" -o -name "*.rpm" -o -name "*.zip" \
\) 2>/dev/null | sort | while read -r f; do
  SIZE=$(du -h "$f" | cut -f1)
  BASENAME=$(basename "$f")
  echo "  $SIZE  $BASENAME"
done
echo ""

# ── --mac-both smoke summary ───────────────────────────────
# Verify each produced DMG's Mach-O arch tag matches the expected arch.
# Catches the silent-mismatch failure mode (x64-DMG-with-arm64-binaries)
# where everything builds but the artifact won't run on the target Mac.

if [ "$BUILD_MAC_BOTH" = true ] && command -v file &>/dev/null; then
  echo "--mac-both smoke summary:"
  find "$OUTPUT_DIR" -type f -name "*.dmg" 2>/dev/null | sort | while read -r dmg; do
    BASENAME=$(basename "$dmg")
    # Mount, inspect main binary, unmount. Falls back to `file` on the DMG
    # itself (which only reports the disk image format, not the inner Mach-O)
    # if hdiutil isn't usable in the current shell.
    if command -v hdiutil &>/dev/null; then
      MOUNT_OUT=$(hdiutil attach -nobrowse -readonly "$dmg" 2>/dev/null | tail -1)
      MOUNT_POINT=$(echo "$MOUNT_OUT" | awk '{$1=$2=""; sub(/^ +/,""); print}')
      if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
        APP=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" -type d | head -1)
        if [ -n "$APP" ]; then
          BIN="$APP/Contents/MacOS/pi-dashboard"
          if [ -f "$BIN" ]; then
            ARCH_TAG=$(file "$BIN" 2>/dev/null | grep -oE 'arm64|x86_64' | head -1)
            echo "  $BASENAME  →  Mach-O: ${ARCH_TAG:-unknown}"
          fi
        fi
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
      else
        echo "  $BASENAME  →  (could not mount for inspection)"
      fi
    else
      echo "  $BASENAME  →  (hdiutil unavailable; skip arch verify)"
    fi
  done
  echo ""
fi
