#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Spin up a disposable, fully isolated pi-dashboard for manual browser QA.
#
#   cd /path/to/my-project && /path/to/docker/test-up.sh [extra compose args]
#
# Mounts the directory you run this FROM ($PWD) into the container at its
# identical absolute path, writable via a throwaway overlay — host files are
# never modified. Tear down with test-down.sh.
#
# See openspec change docker-test-harness, docker/TESTING.md.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Path-parity target: the caller's CWD (NOT this script's dir).
export HOST_CWD="$PWD"

# Isolation knobs — exported so compose.yml's port publish + the container
# environment both resolve to the non-colliding test values.
export DASHBOARD_PORT=18000
export PI_GATEWAY_PORT=18999
export PI_GATEWAY_BIND=127.0.0.1
export TUNNEL_ENABLED=false

# Overlay mode (default) needs CAP_SYS_ADMIN for the overlay mount; copy mode
# runs with no added capability. Layer the cap file only when NOT copy mode.
COMPOSE_FILES=(-f "${SCRIPT_DIR}/compose.yml" -f "${SCRIPT_DIR}/compose.test.yml")
if [ "${TEST_COPY_MODE:-}" != "1" ]; then
  COMPOSE_FILES+=(-f "${SCRIPT_DIR}/compose.test.cap.yml")
  MODE_NOTE="overlay (CAP_SYS_ADMIN)"
else
  MODE_NOTE="copy (no added capability)"
fi

echo "──────────────────────────────────────────────────────────────"
echo " pi-dashboard test harness"
echo "   URL:          http://localhost:18000"
echo "   workspace:    ${HOST_CWD}  (path-identical, read-write)"
echo "   mode:         ${MODE_NOTE}"
echo "   host files:   never modified — writes land in a throwaway layer"
echo "   teardown:     ${SCRIPT_DIR}/test-down.sh"
echo "──────────────────────────────────────────────────────────────"

exec docker compose "${COMPOSE_FILES[@]}" up "$@"
