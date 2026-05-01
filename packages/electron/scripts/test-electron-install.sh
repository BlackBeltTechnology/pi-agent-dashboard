#!/usr/bin/env bash
#
# End-to-end test of the Electron app's install and server launch flow on clean Linux.
#
# Simulates what happens when a user:
# 1. Installs the .deb/.AppImage on a fresh Linux system
# 2. Runs the setup wizard (standalone mode, no API key)
# 3. The app launches and starts the dashboard server
#
# Runs entirely in Docker — no Electron GUI, but exercises the same code paths:
#   - Bundled server resource layout (with native modules built for Linux)
#   - Bundled Node.js binary
#   - Dependency installation (tsx) into ~/.pi-dashboard/
#   - Server launch via tsx binary (same as server-lifecycle.ts)
#   - Health check verification
#
# Usage:
#   bash packages/electron/scripts/test-electron-install.sh
#   bash packages/electron/scripts/test-electron-install.sh --rebuild  # Force rebuild bundle
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=true
fi

IMAGE_NAME="pi-dashboard-electron-install-test"

echo "════════════════════════════════════════════════════════"
echo "  PI Dashboard — Electron Install Test (Docker)"
echo "════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Ensure server source is bundled ─────────────────────

if [ "$REBUILD" = true ] || [ ! -d "$ELECTRON_DIR/resources/server/packages/server/src" ]; then
  echo "→ Bundling server source (--source-only)..."
  bash "$ELECTRON_DIR/scripts/bundle-server.sh" --source-only
  echo ""
fi

# ── Step 2: Build Docker test image ─────────────────────────────

echo "→ Building Docker test image..."
cd "$PROJECT_DIR"

docker build -f - -t "$IMAGE_NAME" "$ELECTRON_DIR" <<'DOCKERFILE'
FROM ubuntu:22.04

# Minimal deps — simulates a clean desktop Linux install
# python3/make/g++ needed for node-pty native build
# curl/ca-certificates/xz-utils needed for Node.js download
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Simulate Electron's packaged resource layout:
#   /opt/pi-dashboard/resources/node/      — bundled Node.js
#   /opt/pi-dashboard/resources/server/    — bundled server source + deps
#   /opt/pi-dashboard/resources/dirname-shim.js
ENV APP_RESOURCES=/opt/pi-dashboard/resources
RUN mkdir -p $APP_RESOURCES

# Download Linux x64 Node.js (don't copy host binary — might be wrong arch/OS)
RUN mkdir -p /tmp/node-dl && \
    curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz -o /tmp/node-dl/node.tar.xz && \
    tar -xf /tmp/node-dl/node.tar.xz -C /tmp/node-dl && \
    mkdir -p $APP_RESOURCES/node/bin $APP_RESOURCES/node/lib && \
    cp /tmp/node-dl/node-v22.18.0-linux-x64/bin/node $APP_RESOURCES/node/bin/ && \
    cp -r /tmp/node-dl/node-v22.18.0-linux-x64/lib/node_modules $APP_RESOURCES/node/lib/ && \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js $APP_RESOURCES/node/bin/npm && \
    rm -rf /tmp/node-dl

# Copy server source (no node_modules — npm install happens below for Linux)
COPY resources/server/packages $APP_RESOURCES/server/packages
COPY resources/server/packages/dist $APP_RESOURCES/server/packages/dist
COPY resources/server/package.json $APP_RESOURCES/server/package.json

# Install server deps for Linux (same as docker-make.sh)
ENV PATH="$APP_RESOURCES/node/bin:$PATH"
RUN cd $APP_RESOURCES/server && \
    npm install --omit=dev --no-audit --no-fund 2>&1 | tail -10 && \
    # Copy pty.node to prebuilds and remove non-Linux prebuilds \
    mkdir -p node_modules/node-pty/prebuilds/linux-x64 && \
    cp node_modules/node-pty/build/Release/pty.node node_modules/node-pty/prebuilds/linux-x64/ 2>/dev/null || true && \
    rm -rf node_modules/node-pty/prebuilds/darwin-* node_modules/node-pty/prebuilds/win32-*

# Copy dirname shim
COPY resources/dirname-shim.js $APP_RESOURCES/dirname-shim.js

# Create a non-root user to simulate real desktop usage
RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser scripts/test-electron-install-inner.sh /home/testuser/run-test.sh
RUN chmod +x /home/testuser/run-test.sh

ENTRYPOINT ["bash", "/home/testuser/run-test.sh"]
DOCKERFILE

echo ""

# ── Step 3: Run the test ────────────────────────────────────────

echo "→ Running install + launch test in Docker..."
echo ""

docker run --rm "$IMAGE_NAME"
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "════════════════════════════════════════════════════════"
  echo "  ✓ All tests passed!"
  echo "════════════════════════════════════════════════════════"
else
  echo "════════════════════════════════════════════════════════"
  echo "  ✗ Tests failed (exit code: $EXIT_CODE)"
  echo "════════════════════════════════════════════════════════"
fi

exit $EXIT_CODE
