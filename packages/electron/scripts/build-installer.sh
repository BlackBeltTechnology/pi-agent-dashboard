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
#   macOS   → .dmg                in out/make/
#   Linux   → .deb + .AppImage    in out/make/
#   Windows → .exe (NSIS)         in out/make/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

NODE_VERSION="v22.12.0"
SKIP_CLIENT=false
ARCH=""
BUILD_NATIVE=false
BUILD_LINUX=false
BUILD_WINDOWS=false
BUILD_ALL=false
DOCKER_IMAGE="pi-dashboard-electron-builder"

# ── Parse arguments ──────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      BUILD_ALL=true
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
      echo "  --windows         Build Windows .exe (NSIS) via Docker"
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
[ "$BUILD_WINDOWS" = true ] && echo "  • Windows (Docker)      → .exe (NSIS)"
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

# ── Bundle dashboard server ─────────────────────────────

if [ ! -d "$ELECTRON_DIR/resources/server/node_modules" ]; then
  echo ""
  echo "→ Bundling dashboard server..."
  bash "$ELECTRON_DIR/scripts/bundle-server.sh"
else
  echo "✓ Bundled server already present"
fi

# ── Bundle offline npm cache (pi + openspec + tsx) ─────────────
# Per-platform cacache that makes first-run install work fully offline.
# Opt-in via BUNDLE_OFFLINE_PACKAGES=1 — defaults OFF for local dev speed;
# CI sets it for release artifacts.

if [ "${BUNDLE_OFFLINE_PACKAGES:-0}" = "1" ]; then
  if [ ! -f "$ELECTRON_DIR/resources/offline-packages/manifest.json" ]; then
    echo ""
    echo "→ Bundling offline packages (pi + openspec + tsx)..."
    node "$ELECTRON_DIR/scripts/bundle-offline-packages.mjs" --platform="$HOST_PLATFORM-$ARCH"
  else
    echo "✓ Offline package bundle already present"
  fi
else
  echo "→ Skipping offline package bundle (set BUNDLE_OFFLINE_PACKAGES=1 to enable)"
fi

# ── Collect output directory ────────────────────────────────────

OUTPUT_DIR="$ELECTRON_DIR/out/make"

# ── Native build ────────────────────────────────────────────────

if [ "$BUILD_NATIVE" = true ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Building $HOST_LABEL installer (native)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Download bundled Node.js
  if [ "$HOST_PLATFORM" != "win32" ]; then
    if [ ! -f "$ELECTRON_DIR/resources/node/bin/node" ]; then
      echo "→ Downloading Node.js $NODE_VERSION for bundling..."
      cd "$ELECTRON_DIR"
      bash scripts/download-node.sh "$NODE_VERSION" "$HOST_PLATFORM" "$ARCH"
    fi
  fi

  cd "$ELECTRON_DIR"
  npm run make -- --arch "$ARCH"
  echo "✓ $HOST_LABEL build complete"
fi

# ── Docker build helper ─────────────────────────────────────────

docker_build() {
  local TARGET_PLATFORM="$1"
  local TARGET_ARCH="${2:-x64}"
  local LABEL="$3"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Building $LABEL installer (Docker)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  cd "$PROJECT_DIR"

  # Build Docker image for x86_64 (required for NSIS/makensis and x64 native modules)
  docker build \
    --no-cache \
    --platform linux/amd64 \
    -f packages/electron/scripts/Dockerfile.build \
    -t "$DOCKER_IMAGE" \
    . 2>&1 | tail -20

  # Run the build, copy output
  local CONTAINER_NAME="pi-electron-build-$$"
  docker run \
    --platform linux/amd64 \
    --name "$CONTAINER_NAME" \
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
  docker_build "win32" "x64" "Windows"
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
