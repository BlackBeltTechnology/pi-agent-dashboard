#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Tear down the disposable pi-dashboard test harness.
#
#   /path/to/docker/test-down.sh
#
# `down -v` drops the tmpfs pi-state volume and the overlay upper layer —
# all run state is discarded and the host project is left byte-identical.
#
# See openspec change docker-test-harness.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=docker/lib-ports.sh
source "${SCRIPT_DIR}/lib-ports.sh"

# Re-derive the project name from $PWD (same pure cksum function as test-up).
# Identity does NOT depend on the state file — teardown works even when it is
# missing or corrupt. The state file carries only the ports.
project="$(derive_project "$PWD")"
STATE_FILE="${PWD}/.pi-test-harness.json"

# Best-effort: warn on a present-but-unparseable state file, then continue.
if [ -f "$STATE_FILE" ] && ! grep -q '"project"' "$STATE_FILE" 2>/dev/null; then
  echo "parallelize-test-harness: malformed .pi-test-harness.json, derived project from CWD" >&2
fi

# HOST_CWD only needs a value so compose can interpolate the lower-dir bind;
# down does not mount it. Default to /tmp when invoked outside a project.
export HOST_CWD="${HOST_CWD:-/tmp}"

# Per-worktree image tag (same pure function as test-up) so compose interpolates
# the same `image:` and `down` resolves cleanly.
export TEST_IMAGE_TAG="$project"

docker compose -p "$project" \
  -f "${SCRIPT_DIR}/compose.yml" \
  -f "${SCRIPT_DIR}/compose.test.yml" \
  down -v "$@"

# Drop the per-worktree state file after a successful down.
rm -f "$STATE_FILE"

# Remove this worktree's baked image so per-worktree tags don't accumulate.
# Runs AFTER down -v (no container references it). Best-effort/non-fatal: a
# missing tag (never built, or already pruned) must not fail teardown. Targets
# only THIS worktree's tag via the CWD-derived project name; never the base
# pi-dashboard:local. See change fix-parallel-e2e-docker-collisions D4.
docker image rm -f "pi-dashboard:${project}" 2>/dev/null || true
