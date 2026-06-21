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

# HOST_CWD only needs a value so compose can interpolate the lower-dir bind;
# down does not mount it. Default to /tmp when invoked outside a project.
export HOST_CWD="${HOST_CWD:-/tmp}"

exec docker compose \
  -f "${SCRIPT_DIR}/compose.yml" \
  -f "${SCRIPT_DIR}/compose.test.yml" \
  down -v "$@"
