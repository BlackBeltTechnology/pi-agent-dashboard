#!/usr/bin/env bash
#
# End-to-end test of the bundled-server launch on clean Linux x64.
#
# Runs the same `start-server.sh` argv that real users see — the one shipped
# inside `resources/server/` and the one the Electron main process uses.
# Catches Linux-specific issues the host vitest smoke can't see: glibc-linked
# native modules (node-pty), Linux npm reconciliation, non-root user perms.
#
# Bundle-only flow (post-`eliminate-electron-runtime-install`):
#   - `bundle-server.mjs` produces `resources/server/` with pi/openspec/tsx
#     pre-installed under `node_modules/`.
#   - No `~/.pi-dashboard/` writes for install, no offline cacache.
#   - Container runs `npm install --omit=dev` once to relink node-pty
#     against this Ubuntu's glibc.
#
# Usage:
#   bash packages/electron/scripts/test-electron-install.sh
#   bash packages/electron/scripts/test-electron-install.sh --rebuild
#
# See change: bump-pi-compat-to-0-78 (rewrite for bundle-only flow).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"

REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=true
fi

IMAGE_NAME="pi-dashboard-bundled-server-test"

echo "════════════════════════════════════════════════════════"
echo "  PI Dashboard — Bundled Server Test (clean Ubuntu Docker)"
echo "════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Ensure server source is bundled ───────────────────────────────────

if [ "$REBUILD" = true ] || [ ! -d "$ELECTRON_DIR/resources/server/packages/server/src" ]; then
  echo "→ Bundling server source (--source-only)..."
  node "$ELECTRON_DIR/scripts/bundle-server.mjs" --source-only
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
# procps for `ps aux` (used by session-spawn assertion in inner script).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils python3 make g++ procps \
    && rm -rf /var/lib/apt/lists/*

ENV APP_RESOURCES=/opt/pi-dashboard/resources
RUN mkdir -p $APP_RESOURCES

# Bundled Node v24.15.0 (matches BUNDLED_NODE_VERSION in scripts/_node-version.sh).
RUN mkdir -p /tmp/node-dl && \
    curl -fsSL https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz \
      -o /tmp/node-dl/node.tar.xz && \
    tar -xf /tmp/node-dl/node.tar.xz -C /tmp/node-dl && \
    mkdir -p $APP_RESOURCES/node/bin $APP_RESOURCES/node/lib && \
    cp /tmp/node-dl/node-v24.15.0-linux-x64/bin/node $APP_RESOURCES/node/bin/ && \
    cp -r /tmp/node-dl/node-v24.15.0-linux-x64/lib/node_modules $APP_RESOURCES/node/lib/ && \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js $APP_RESOURCES/node/bin/npm && \
    rm -rf /tmp/node-dl

# Copy bundle. We deliberately copy package.json + packages/ but NOT
# node_modules — npm install runs inside the image so the native
# modules (node-pty) link against this Ubuntu's glibc, not the host's.
# `bundle-server.mjs --source-only` does NOT emit a package-lock.json;
# `npm install --omit=dev` below resolves fresh against the registry,
# which is what we want here (verifies the live-resolution path that
# fresh `npm install` users see).
COPY resources/server/package.json $APP_RESOURCES/server/package.json
COPY resources/server/packages $APP_RESOURCES/server/packages
# Manual-launch helper shipped in the real bundle (also used by this test).
COPY resources/server/start-server.sh $APP_RESOURCES/server/start-server.sh
RUN chmod +x $APP_RESOURCES/server/start-server.sh

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

echo "→ Running bundled-server test in Docker..."
echo ""

EXIT_CODE=0
docker run --rm --platform linux/amd64 "$IMAGE_NAME" || EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "════════════════════════════════════════════════════════"
  echo "  ✓ Bundled-server test passed"
  echo "════════════════════════════════════════════════════════"
else
  echo "════════════════════════════════════════════════════════"
  echo "  ✗ Bundled-server test failed (exit $EXIT_CODE)"
  echo "════════════════════════════════════════════════════════"
fi

exit $EXIT_CODE
