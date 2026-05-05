#!/usr/bin/env bash
#
# End-to-end test of the V2 LaunchSource bootstrap on clean Linux x64.
#
# Mirrors the production path users see when they extract a Linux .deb / .AppImage
# and the Electron app launches for the first time:
#   1. extractBundle      — cpSync resources/server/ → ~/.pi-dashboard/
#   2. swap-aside + install — installStandalone runs npm against the offline
#                              cacache, populating ~/.pi-dashboard/node_modules/
#                              with @mariozechner/pi-coding-agent (jiti).
#   3. merge bundle back   — cpSync the swap-aside back so the bundle's
#                              @blackbelt-technology/* survives npm pruning.
#   4. spawn               — node --import <jiti-register> <cliPath>
#   5. health              — curl /api/health expects starter:Electron.
#
# Complements packages/electron/src/lib/__tests__/launch-source.smoke.test.ts
# (which runs on the dev's host). This script catches Linux-specific issues
# the host smoke can't see: glibc-linked native modules (node-pty), Linux
# npm reconciliation behavior, non-root user perms.
#
# Usage:
#   bash packages/electron/scripts/test-electron-install.sh
#   bash packages/electron/scripts/test-electron-install.sh --rebuild  # Force rebuild bundle
#
# See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=true
fi

IMAGE_NAME="pi-dashboard-bootstrap-v2-test"

echo "════════════════════════════════════════════════════════"
echo "  PI Dashboard — Bootstrap V2 Test (clean Ubuntu Docker)"
echo "════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Ensure server source + offline cache are bundled ──────────────────

if [ "$REBUILD" = true ] || [ ! -d "$ELECTRON_DIR/resources/server/packages/server/src" ]; then
  echo "→ Bundling server source (--source-only)..."
  node "$ELECTRON_DIR/scripts/bundle-server.mjs" --source-only
  echo ""
fi

if [ ! -f "$ELECTRON_DIR/resources/offline-packages/manifest.json" ]; then
  echo "→ Bundling offline-packages cacache (linux-x64)..."
  node "$ELECTRON_DIR/scripts/bundle-offline-packages.mjs" --platform=linux-x64
  echo ""
fi

# ── Step 2: Build Docker test image ───────────────────────────────────────────

echo "→ Building Docker test image..."
cd "$PROJECT_DIR"

docker build --platform linux/amd64 -f - -t "$IMAGE_NAME" "$ELECTRON_DIR" <<'DOCKERFILE'
FROM ubuntu:22.04

# Minimal deps — simulates a clean desktop Linux install.
# python3/make/g++ for any node-gyp fallback;
# curl/ca-certificates/xz-utils for Node download.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV APP_RESOURCES=/opt/pi-dashboard/resources
RUN mkdir -p $APP_RESOURCES

# Bundled Node v22.18.0 (matches production pin in
# packages/electron/scripts/download-node.sh + build-windows-zip.sh).
RUN mkdir -p /tmp/node-dl && \
    curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz \
      -o /tmp/node-dl/node.tar.xz && \
    tar -xf /tmp/node-dl/node.tar.xz -C /tmp/node-dl && \
    mkdir -p $APP_RESOURCES/node/bin $APP_RESOURCES/node/lib && \
    cp /tmp/node-dl/node-v22.18.0-linux-x64/bin/node $APP_RESOURCES/node/bin/ && \
    cp -r /tmp/node-dl/node-v22.18.0-linux-x64/lib/node_modules $APP_RESOURCES/node/lib/ && \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js $APP_RESOURCES/node/bin/npm && \
    rm -rf /tmp/node-dl

# Copy bundle. We deliberately copy package.json + package-lock + packages/
# but NOT node_modules — npm install runs inside the image so the native
# modules (node-pty) link against this Ubuntu's glibc, not the host's.
# This matches what packages/electron/scripts/docker-make.sh does for
# the Linux build path.
COPY resources/server/package.json $APP_RESOURCES/server/package.json
COPY resources/server/package-lock.json $APP_RESOURCES/server/package-lock.json
COPY resources/server/packages $APP_RESOURCES/server/packages

ENV PATH="$APP_RESOURCES/node/bin:$PATH"
RUN cd $APP_RESOURCES/server \
 && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -10 \
 && mkdir -p node_modules/node-pty/prebuilds/linux-x64 \
 && cp node_modules/node-pty/build/Release/pty.node \
       node_modules/node-pty/prebuilds/linux-x64/ 2>/dev/null || true \
 && rm -rf node_modules/node-pty/prebuilds/darwin-* \
           node_modules/node-pty/prebuilds/win32-*

# Materialize workspace symlinks under @blackbelt-technology/* (mirrors
# packages/electron/scripts/bundle-server.mjs and docker-make.sh —
# Node's cpSync would otherwise rewrite relative symlinks as absolute
# build-time paths).
RUN cd $APP_RESOURCES/server/node_modules/@blackbelt-technology && \
    for link in *; do \
      if [ -L "$link" ]; then \
        target=$(readlink -f "$link") && \
        rm "$link" && \
        cp -R "$target" "$link"; \
      fi; \
    done

# Offline cacache for the runtime-baseline install.
COPY resources/offline-packages $APP_RESOURCES/offline-packages

# Non-root user simulating a real desktop session.
RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser scripts/test-electron-install-inner.sh /home/testuser/run-test.sh
RUN chmod +x /home/testuser/run-test.sh

ENTRYPOINT ["bash", "/home/testuser/run-test.sh"]
DOCKERFILE

echo ""

# ── Step 3: Run the test ──────────────────────────────────────────────────────

echo "→ Running V2 bootstrap test in Docker..."
echo ""

EXIT_CODE=0
docker run --rm --platform linux/amd64 "$IMAGE_NAME" || EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "════════════════════════════════════════════════════════"
  echo "  ✓ Bootstrap V2 test passed"
  echo "════════════════════════════════════════════════════════"
else
  echo "════════════════════════════════════════════════════════"
  echo "  ✗ Bootstrap V2 test failed (exit $EXIT_CODE)"
  echo "════════════════════════════════════════════════════════"
fi

exit $EXIT_CODE
