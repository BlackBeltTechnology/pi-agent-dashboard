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
# shellcheck source=docker/lib-ports.sh
source "${SCRIPT_DIR}/lib-ports.sh"

# Path-parity target: the caller's CWD (NOT this script's dir).
export HOST_CWD="$PWD"
STATE_FILE="${HOST_CWD}/.pi-test-harness.json"

# Unique compose project name — pure function of HOST_CWD, so parallel
# worktrees get distinct container/network/volume namespaces (and teardown can
# re-derive it). Independent of the chosen ports + state file.
export COMPOSE_PROJECT_NAME
COMPOSE_PROJECT_NAME="$(derive_project "$HOST_CWD")"

# Hash-derive a free port pair from HOST_CWD, probing within disjoint windows.
derive_ports() {
  local h base_dash base_gw
  h="$(derive_hash "$HOST_CWD")"
  base_dash=$(( DASH_LO + h % 1000 ))
  base_gw=$(( GW_LO + h % 1000 ))
  DASHBOARD_PORT="$(find_free_in_window "$base_dash" "$DASH_LO" "$DASH_HI")" || exit 1
  PI_GATEWAY_PORT="$(find_free_in_window "$base_gw" "$GW_LO" "$GW_HI")" || exit 1
}

# Resolve the dashboard + gateway host ports. Three paths:
#   both vars exported  -> use verbatim, skip probing (e2e harness contract)
#   exactly one set     -> usage error (no half-derived state)
#   neither set         -> idempotent re-up reuse, else hash-derive + probe
if [ -n "${DASHBOARD_PORT:-}" ] && [ -n "${PI_GATEWAY_PORT:-}" ]; then
  : # honoured as a pair — verbatim
elif [ -n "${DASHBOARD_PORT:-}" ] || [ -n "${PI_GATEWAY_PORT:-}" ]; then
  echo "parallelize-test-harness: export BOTH DASHBOARD_PORT and PI_GATEWAY_PORT, or neither" >&2
  exit 1
elif [ -f "$STATE_FILE" ] && [ -n "$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q 2>/dev/null)" ]; then
  # Idempotent re-up: the worktree's project is already running — reuse the
  # recorded ports instead of hunting a new pair.
  DASHBOARD_PORT="$(sed -n 's/.*"dashboardPort"[: ]*\([0-9][0-9]*\).*/\1/p' "$STATE_FILE")"
  PI_GATEWAY_PORT="$(sed -n 's/.*"gatewayPort"[: ]*\([0-9][0-9]*\).*/\1/p' "$STATE_FILE")"
  # Malformed/empty state on a running project: don't reuse garbage — re-derive.
  if ! [[ "$DASHBOARD_PORT" =~ ^[0-9]+$ && "$PI_GATEWAY_PORT" =~ ^[0-9]+$ ]]; then
    echo "parallelize-test-harness: malformed $STATE_FILE, re-deriving ports" >&2
    derive_ports
  fi
else
  derive_ports
fi
export DASHBOARD_PORT PI_GATEWAY_PORT
export PI_GATEWAY_BIND=127.0.0.1
export TUNNEL_ENABLED=false

# Record the resolved ports + project for teardown + the Playwright lifecycle.
# Gitignored; harmless inside the container (read-only overlay lower).
cat > "$STATE_FILE" <<EOF
{ "project": "${COMPOSE_PROJECT_NAME}", "dashboardPort": ${DASHBOARD_PORT}, "gatewayPort": ${PI_GATEWAY_PORT} }
EOF

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
echo "   URL:          http://localhost:${DASHBOARD_PORT}"
echo "   project:      ${COMPOSE_PROJECT_NAME}"
echo "   workspace:    ${HOST_CWD}  (path-identical, read-write)"
echo "   mode:         ${MODE_NOTE}"
echo "   host files:   never modified — writes land in a throwaway layer"
echo "   teardown:     ${SCRIPT_DIR}/test-down.sh"
echo "──────────────────────────────────────────────────────────────"

exec docker compose -p "$COMPOSE_PROJECT_NAME" "${COMPOSE_FILES[@]}" up "$@"
