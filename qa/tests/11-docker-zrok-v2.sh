#!/usr/bin/env bash
# Test (M6, support-zrok-v2): the docker image ships zrok v2 and both the
# `zrok2` binary and the `zrok` symlink report v2.
set -euo pipefail

echo "=== Test: docker image ships zrok v2 (zrok2 + zrok symlink) ==="

# Resolve the repo root (this file lives at qa/tests/).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_TAG="pi-dashboard-zrok-v2-smoke:test"

# Build only the `base` stage — zrok is installed there, so this is the
# cheapest build that validates the Dockerfile zrok change.
docker build --target base -t "${IMAGE_TAG}" -f "${REPO_ROOT}/docker/Dockerfile" "${REPO_ROOT}"

# Both names must resolve and report a v2.x version.
for bin in zrok2 zrok; do
  out="$(docker run --rm "${IMAGE_TAG}" "${bin}" version 2>&1 || true)"
  echo "${bin} version: ${out}"
  if ! echo "${out}" | grep -Eq 'v?2\.[0-9]+\.[0-9]+'; then
    echo "FAIL: ${bin} did not report a v2.x version"
    exit 1
  fi
done

echo "PASS: zrok2 and zrok both report v2"
