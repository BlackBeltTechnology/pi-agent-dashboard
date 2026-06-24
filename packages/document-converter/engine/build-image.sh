#!/usr/bin/env bash
# Build the pi-doc-engine image from the in-repo vendored engine copy.
#
#   ./build-image.sh            # build pi-doc-engine:<IMAGE_VERSION>
#   IMAGE_TAG=pi-doc-engine:dev ./build-image.sh
#
# The build context is THIS directory only — the image must reference no
# home-directory path. A guard below fails the build if a ~/Documents reference
# leaked into the vendored source.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_VERSION="$(cat "$ENGINE_DIR/IMAGE_VERSION")"
IMAGE_TAG="${IMAGE_TAG:-pi-doc-engine:${IMAGE_VERSION}}"

# --- Guard: no home-dir / ~/Documents path may leak into the runtime Python ---
# Scoped to *.py runtime source (the only code that ships); meta files (this
# script, Dockerfile, VENDOR.md) legitimately name the pattern in prose.
GUARD_PAT='~/Documents|/Users/[^/]+/Documents|\.gemini/skills|\.agents/skills'
if grep -RInE "$GUARD_PAT" "$ENGINE_DIR" --include='*.py' \
     --exclude-dir=__pycache__ >/dev/null 2>&1; then
  echo "ERROR: home-dir / source-skill path reference found in engine Python:" >&2
  grep -RInE "$GUARD_PAT" "$ENGINE_DIR" --include='*.py' --exclude-dir=__pycache__ >&2
  exit 1
fi

echo "Building ${IMAGE_TAG} from ${ENGINE_DIR} ..."
docker build -t "${IMAGE_TAG}" "${ENGINE_DIR}"
echo "Built ${IMAGE_TAG}"
