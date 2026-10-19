#!/usr/bin/env bash
# Single source of truth for the bundled Node.js version shipped inside the
# Electron app (resources/node/) and the Docker images used to build it.
#
# Update this file alone when bumping Node; every build/test script sources
# it. Pinned on the latest active Node.js LTS line.
#
# Sourced by:
#   download-node.sh, build-installer.sh, build-windows-zip.sh, docker-make.sh
#
# Static (not sourced — keep in sync manually):
#   Dockerfile.build           (FROM node:${BUNDLED_NODE_MAJOR}-bookworm-slim,
#                              overridable via --build-arg NODE_BUILD_IMAGE)
#   test-server-launch.sh      (heredoc Dockerfile)
#   test-electron-install.sh   (heredoc Dockerfile)

export BUNDLED_NODE_VERSION="v24.22.0"
export BUNDLED_NODE_MAJOR="24"
