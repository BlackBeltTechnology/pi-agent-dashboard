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

# Per-worktree image tag (pure function of HOST_CWD via the project name). The
# dashboard server+client run from BAKED image source, so a shared tag would
# silently run another worktree's code. compose.test.yml reads this; teardown
# re-derives + removes it. Falls back to :local when unset (manual base flow).
# See change fix-parallel-e2e-docker-collisions D3.
export TEST_IMAGE_TAG="$COMPOSE_PROJECT_NAME"

# ---------------------------------------------------------------- co-resident guard
# #451 part 2. Two 4 GiB harnesses saturate an 8 GB VM, and a red run under that
# contention cannot be attributed (one worktree's container was even observed
# destroyed mid-run). Compare THIS start plus every other running harness
# against the daemon's MemTotal. Refuse when the limits do not fit, WARN when
# they fit but a peer is up (attribution is degraded). Runs BEFORE the image
# build and before the state file is written, so a refusal costs nothing and
# leaves no half-started state. `>=` is deliberate: the host must also keep
# running, so limits that exactly equal MemTotal are already oversubscribed.
# One code path in and out of CI — a CI runner has one harness, so only the
# lone-harness cap check (silent when it fits) applies there. See change: stabilize-browser-e2e, docker/TESTING.md.
MEM_LIMIT_RAW="${MEM_LIMIT:-4g}"
PEER_HARNESSES="$(list_running_harness_projects "$COMPOSE_PROJECT_NAME")"
PEER_NAMES=""
PEER_COUNT=0
if [ -n "$PEER_HARNESSES" ]; then
  PEER_NAMES="$(printf '%s' "$PEER_HARNESSES" | tr '\n' ',' | sed 's/,$//')"
  PEER_COUNT="$(printf '%s\n' "$PEER_HARNESSES" | grep -c .)"
fi
# The arithmetic runs with PEER_COUNT=0 too: a lone harness whose cap alone
# does not fit is refused. A lone run never gains noise from missing data or a
# fitting cap. See change: close-e2e-tooling-followups (#701.1, design D2).
INSTANCES=$(( PEER_COUNT + 1 ))
LIMIT_BYTES="$(parse_memory_bytes "$MEM_LIMIT_RAW" || true)"
MEM_TOTAL="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
if [ -z "$LIMIT_BYTES" ] || ! [[ "$MEM_TOTAL" =~ ^[0-9]+$ ]]; then
  if [ "$PEER_COUNT" -gt 0 ]; then
    echo "stabilize-browser-e2e: cannot read memory limits (MEM_LIMIT=${MEM_LIMIT_RAW:-unset}, MemTotal=${MEM_TOTAL:-unavailable}) — another harness is up (${PEER_NAMES}); proceeding without the oversubscription check" >&2
  fi
else
  REQUIRED_BYTES=$(( INSTANCES * LIMIT_BYTES ))
  if [ "$REQUIRED_BYTES" -lt "$MEM_TOTAL" ]; then
    if [ "$PEER_COUNT" -gt 0 ]; then
      echo "stabilize-browser-e2e: another test harness is up (${PEER_NAMES}); ${INSTANCES} × $(human_bytes "$LIMIT_BYTES") fits in $(human_bytes "$MEM_TOTAL") but a red run cannot be attributed under contention" >&2
    fi
  elif [ "${PI_HARNESS_ALLOW_OVERSUBSCRIBE:-}" = "1" ]; then
    echo "stabilize-browser-e2e: oversubscribed — ${INSTANCES} × $(human_bytes "$LIMIT_BYTES") = $(human_bytes "$REQUIRED_BYTES") >= $(human_bytes "$MEM_TOTAL") MemTotal; proceeding because PI_HARNESS_ALLOW_OVERSUBSCRIBE=1" >&2
  else
    if [ "$PEER_COUNT" -gt 0 ]; then
      echo "stabilize-browser-e2e: refusing to start — co-resident harness oversubscription" >&2
      echo "  other harness project(s): ${PEER_NAMES}" >&2
    else
      echo "stabilize-browser-e2e: refusing to start — harness memory cap exceeds the daemon" >&2
    fi
    echo "  memory: ${INSTANCES} × $(human_bytes "$LIMIT_BYTES") = $(human_bytes "$REQUIRED_BYTES")  >=  $(human_bytes "$MEM_TOTAL") MemTotal (MEM_LIMIT=${MEM_LIMIT_RAW})" >&2
    echo "  set PI_HARNESS_ALLOW_OVERSUBSCRIBE=1 to start anyway" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- lifecycle recorder
# #451 part 1 (change: add-missing-ci-legs, design D7). A worktree's harness
# container was once destroyed mid-run by something outside its own test-down.sh
# and the run reported a wall of unattributable failures. The evidence has to
# exist BEFORE the incident, so the recorder is started HERE (every caller — the
# Playwright managed mode, ship-it, a developer — goes through this script),
# scoped to THIS project, before `compose up` so the create/start lines are kept.
# The events file lives under $TMPDIR, NOT in the worktree: ship-it removes the
# worktree right after teardown, which would delete an in-worktree record.
# Best-effort: any "no working recorder" cause (events stream cannot be opened,
# events dir unwritable) prints ONE warning line and the harness boots normally.
EVENTS_DIR="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/pi-dash-test"
EVENTS_FILE="${EVENTS_DIR}/${COMPOSE_PROJECT_NAME}.events.log"
RECORDER_PID=""
CONTAINER_ID=""

state_field() { # <field> — scalar field of the PRIOR state file ("" when absent)
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/.*\"$1\"[: ]*\"\{0,1\}\([^\",} ]*\).*/\1/p" "$STATE_FILE" | head -1
}
PRIOR_RECORDER_PID="$(state_field recorderPid)"
PRIOR_CONTAINER_ID="$(state_field containerId)"
PRIOR_EVENTS_FILE="$(state_field eventsFile)"

start_recorder() {
  # Idempotent re-up: reuse a live recorder instead of spawning a second one.
  # Live AND still a harness-audit.sh: a recycled PID must never be adopted.
  if [[ "$PRIOR_RECORDER_PID" =~ ^[0-9]+$ ]] && kill -0 "$PRIOR_RECORDER_PID" 2>/dev/null \
    && ps -p "$PRIOR_RECORDER_PID" -o command= 2>/dev/null | grep -q 'harness-audit\.sh'; then
    RECORDER_PID="$PRIOR_RECORDER_PID"
    [ -n "$PRIOR_EVENTS_FILE" ] && EVENTS_FILE="$PRIOR_EVENTS_FILE"
    return 0
  fi
  local reason="" errf
  if ! mkdir -p "$EVENTS_DIR" 2>/dev/null || ! : >> "$EVENTS_FILE" 2>/dev/null; then
    reason="events dir ${EVENTS_DIR} is not writable"
  else
    errf="$(mktemp "${EVENTS_DIR}/.recorder-err.XXXXXX" 2>/dev/null || mktemp)"
    nohup "${SCRIPT_DIR}/harness-audit.sh" "$EVENTS_FILE" "$COMPOSE_PROJECT_NAME" </dev/null >/dev/null 2>"$errf" &
    RECORDER_PID=$!
    disown "$RECORDER_PID" 2>/dev/null || true
    sleep 0.5 # an unusable `docker events` (permissions, no daemon) exits at once
    if ! kill -0 "$RECORDER_PID" 2>/dev/null; then
      reason="$(grep -v '^harness-audit:' "$errf" 2>/dev/null | head -1 || true)"
      [ -n "$reason" ] || reason="docker events exited"
      RECORDER_PID=""
    fi
    rm -f "$errf"
  fi
  if [ -z "$RECORDER_PID" ]; then
    echo "harness-audit: lifecycle capture unavailable (${reason}); continuing" >&2
  fi
  return 0
}
start_recorder

# A failed boot must not leak the recorder it started; a successful one hands
# it to test-down.sh (or its own armed self-termination).
UP_OK=0
stop_recorder_on_failure() {
  if [ "$UP_OK" != "1" ] && [ -n "$RECORDER_PID" ] && [ "$RECORDER_PID" != "$PRIOR_RECORDER_PID" ]; then
    kill "$RECORDER_PID" 2>/dev/null || true
  fi
}
trap 'stop_recorder_on_failure' EXIT # replaced (superset) once UP_STDERR exists

# Whether WE own the chosen ports (derived/reused) and may re-derive them on a
# bind-race retry, vs. pinned verbatim by an external caller (contract: honour
# exactly, never re-derive). Set to 1 only in the verbatim branch below.
PORTS_PINNED=0

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
  PORTS_PINNED=1 # honoured as a pair — verbatim, no re-derive on bind race
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

# Flow-plugin e2e peer selector (change: add-flow-plugin-e2e-tests). Passed
# through to the container (compose.test.yml -> test-entrypoint.sh) which wires
# the pi-flows engine + anthropic-messages bridge peer accordingly:
#   both | no-am | legacy | bad-registration   (unset => no flow-peer wiring)
# Requires PI_E2E_SEED=1. Boot a specific variant for manual /api/health checks:
#   PI_E2E_SEED=1 PI_TEST_PEERS=no-am /path/to/docker/test-up.sh -d --build
export PI_TEST_PEERS="${PI_TEST_PEERS:-}"

# Browser-relay e2e faucet (change: add-browser-relay, task 7.61). Passed
# through to the container (compose.test.yml -> test-entrypoint.sh) which enables
# the browser plugin + seeds a socket-less `Fake` instance, so the L3 spec can
# drive the settings/tile surfaces without real Chrome. Requires PI_E2E_SEED=1.
#   PI_E2E_SEED=1 PI_BROWSER_RELAY_FAKE=1 docker/test-up.sh -d --build
export PI_BROWSER_RELAY_FAKE="${PI_BROWSER_RELAY_FAKE:-}"

# Chat-gateway team-controls e2e faucet (change:
# add-chat-gateway-team-controls, task 10g). Passed through to the container
# (compose.test.yml -> test-entrypoint.sh) which seeds `plugins["chat-gateway"]`
# and selects the socket-less platform fixture, so the L3 specs have a surface
# to render. Requires PI_E2E_SEED=1.
#   1 | nolist   (unset => harness unchanged)
#   PI_E2E_SEED=1 PI_CHAT_GATEWAY_FAKE=1 docker/test-up.sh -d --build
# Exported here deliberately: compose substitutes ${PI_CHAT_GATEWAY_FAKE} from
# the SHELL environment, so without this the faucet resolves to empty and
# silently does nothing even when the caller sets it.
export PI_CHAT_GATEWAY_FAKE="${PI_CHAT_GATEWAY_FAKE:-}"
export PI_CHAT_GATEWAY_FAKE_DIR="${PI_CHAT_GATEWAY_FAKE_DIR:-}"

# gmail-plugin fake-Google endpoint (change: add-gmail-plugin, design D8).
# Passed through to the container (compose.test.yml); the plugin honours it
# ONLY for a loopback URL, and tests/e2e/gmail-plugin.spec.ts starts the fake on
# that in-container port. Defaulted so the spec needs no extra flag.
export PI_E2E_GOOGLE_BASE_URL="${PI_E2E_GOOGLE_BASE_URL:-http://127.0.0.1:18090}"

# Runtime-delivery canary (change: decouple-plugins-from-core, tasks 7.5 / 8.2 / 8.3).
# Under PI_E2E_SEED=1 the harness stages the prebuilt runtime canary
# (tests/fixtures/runtime-canary-plugin) into ${HOST_CWD}/.pi-test-canary BEFORE `compose up`; the container sees it
# through the path-parity overlay and test-entrypoint.sh copies it into ~/.pi/dashboard/plugins/ and pre-seeds
# `auth.trustedPlugins`. The canary is built ONCE here and hashed with the server's own content hasher — never
# rebuilt after seeding, so the pin always equals the served hash. The HOST needs the repo's node_modules.
#   PI_E2E_CANARY=trusted     (default) base canary, pinned → its claims render
#   PI_E2E_CANARY=untrusted   base canary WITHOUT a trust entry + the four failure variants copied next to it
#   PI_E2E_CANARY=off         nothing staged (harness unchanged)
# PI_DASHBOARD_CSP=enforce boots the server with the ENFORCING CSP (default: report-only). Both are passed through
# to the container (compose.test.yml). Exported explicitly: compose substitutes from the SHELL environment.
export PI_E2E_CANARY="${PI_E2E_CANARY:-}"
export PI_DASHBOARD_CSP="${PI_DASHBOARD_CSP:-}"
CANARY_STAGE_DIR="${HOST_CWD}/.pi-test-canary"
rm -rf "$CANARY_STAGE_DIR"
if [ "${PI_E2E_SEED:-}" = "1" ] && [ "${PI_E2E_CANARY:-trusted}" != "off" ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  node "${REPO_ROOT}/scripts/stage-runtime-canary.mjs" --out "$CANARY_STAGE_DIR" --mode "${PI_E2E_CANARY:-trusted}" >&2 || {
    echo "runtime-canary: staging failed (needs the repo's node_modules on the host); set PI_E2E_CANARY=off to skip" >&2
    exit 1
  }
fi

# Extra overlays (TEST_EXTRA_COMPOSE, whitespace-separated basenames under
# docker/). Recorded in the state file as `extraCompose` so test-down.sh tears
# the same stack down WITHOUT the env var (e.g. ship-it's trap). Always written,
# `[]` when none. See change: add-acme-dns01-certs (design D10).
read -r -a EXTRA_COMPOSE <<< "${TEST_EXTRA_COMPOSE:-}"
EXTRA_COMPOSE_JSON="["
for f in ${EXTRA_COMPOSE[@]+"${EXTRA_COMPOSE[@]}"}; do
  [ "$EXTRA_COMPOSE_JSON" = "[" ] || EXTRA_COMPOSE_JSON="${EXTRA_COMPOSE_JSON}, "
  EXTRA_COMPOSE_JSON="${EXTRA_COMPOSE_JSON}\"${f}\""
done
EXTRA_COMPOSE_JSON="${EXTRA_COMPOSE_JSON}]"

# Record the resolved ports + project for teardown + the Playwright lifecycle.
# Gitignored; harmless inside the container (read-only overlay lower).
write_state_file() {
  local extra=", \"extraCompose\": ${EXTRA_COMPOSE_JSON}"
  if [ -n "$RECORDER_PID" ]; then
    extra="${extra}, \"recorderPid\": ${RECORDER_PID}, \"eventsFile\": \"${EVENTS_FILE}\""
  fi
  [ -n "$CONTAINER_ID" ] && extra="${extra}, \"containerId\": \"${CONTAINER_ID}\""
  cat > "$STATE_FILE" <<EOF
{ "project": "${COMPOSE_PROJECT_NAME}", "dashboardPort": ${DASHBOARD_PORT}, "gatewayPort": ${PI_GATEWAY_PORT}${extra} }
EOF
}
write_state_file

# Overlay mode (default) needs CAP_SYS_ADMIN for the overlay mount; copy mode
# runs with no added capability. Layer the cap file only when NOT copy mode.
COMPOSE_FILES=(-f "${SCRIPT_DIR}/compose.yml" -f "${SCRIPT_DIR}/compose.test.yml")
if [ "${TEST_COPY_MODE:-}" != "1" ]; then
  COMPOSE_FILES+=(-f "${SCRIPT_DIR}/compose.test.cap.yml")
  MODE_NOTE="overlay (CAP_SYS_ADMIN)"
else
  MODE_NOTE="copy (no added capability)"
fi
# Optional extra overlay layered LAST (highest precedence). Used by the
# identity-plane E2E to boot an identity-ACTIVE harness
# (TEST_EXTRA_COMPOSE=compose.test.identity.yml). Off by default ⇒ the shared
# harness is byte-for-byte unchanged. See openspec: add-multi-user-identity-plane.
for f in ${EXTRA_COMPOSE[@]+"${EXTRA_COMPOSE[@]}"}; do
  COMPOSE_FILES+=(-f "${SCRIPT_DIR}/${f}")
  MODE_NOTE="${MODE_NOTE} + ${f}"
done

echo "──────────────────────────────────────────────────────────────"
echo " pi-dashboard test harness"
echo "   URL:          http://localhost:${DASHBOARD_PORT}"
echo "   project:      ${COMPOSE_PROJECT_NAME}"
echo "   workspace:    ${HOST_CWD}  (path-identical, read-write)"
echo "   mode:         ${MODE_NOTE}"
echo "   host files:   never modified — writes land in a throwaway layer"
echo "   teardown:     ${SCRIPT_DIR}/test-down.sh"
echo "──────────────────────────────────────────────────────────────"

# Bring the stack up. Wrap in a bounded retry that re-derives the next free
# port in-window ONLY when the daemon reports a bind collision (closes the
# residual probe→bind TOCTOU gap). Non-port failures propagate immediately so
# real boot errors are never masked. Skipped when ports were pinned verbatim.
# See change fix-parallel-e2e-docker-collisions D2.
MAX_BIND_RETRIES=5
UP_STDERR="$(mktemp)"
trap 'rm -f "$UP_STDERR"; stop_recorder_on_failure' EXIT
attempt=0
while true; do
  # Capture docker's stderr through a REAL pipe (not process substitution): bash
  # waits for the whole pipeline to finish before the grep below, so the bind-
  # collision check sees fully-flushed output (process substitution does not
  # sync, and could race the grep). fd3 carries docker stdout to the terminal;
  # stderr is tee'd live (attached manual flow) AND captured to UP_STDERR.
  # `|| status=$?` keeps set -e from killing the script on a retryable failure;
  # pipefail makes status reflect docker's exit (tee succeeds).
  status=0
  { docker compose -p "$COMPOSE_PROJECT_NAME" "${COMPOSE_FILES[@]}" up "$@" 2>&1 1>&3 3>&- | tee "$UP_STDERR" >&2; } 3>&1 || status=$?
  if [ "$status" -eq 0 ]; then
    break
  fi
  if [ "$PORTS_PINNED" = "1" ] || ! grep -q 'port is already allocated' "$UP_STDERR"; then
    exit "$status"
  fi
  if (( attempt >= MAX_BIND_RETRIES )); then
    echo "fix-parallel-e2e-docker-collisions: port bind kept colliding after ${MAX_BIND_RETRIES} retries" >&2
    exit 1
  fi
  attempt=$(( attempt + 1 ))
  echo "fix-parallel-e2e-docker-collisions: port already allocated — re-deriving (attempt ${attempt}/${MAX_BIND_RETRIES})" >&2
  derive_ports
  export DASHBOARD_PORT PI_GATEWAY_PORT
  write_state_file
done

# Compose is up. Record WHICH container this boot produced: the boot line, the
# teardown marker and any destroy line are all matched by container ID (the
# project name is stable across boots, the ID is not), so an earlier boot's
# teardown can never explain away a foreign destroy of this boot's container.
# Attached (no -d) runs never reach here while the harness lives; there the
# recorder writes the boot line itself when it sees the create event.
UP_OK=1
if [ -n "$RECORDER_PID" ]; then
  # Name the service: an overlay (TEST_EXTRA_COMPOSE) adds sibling containers.
  CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q pi-dashboard 2>/dev/null | head -1 || true)"
  if [ -n "$CONTAINER_ID" ]; then
    if [ "$CONTAINER_ID" != "$PRIOR_CONTAINER_ID" ] && ! grep -q "^boot .* ${CONTAINER_ID}\$" "$EVENTS_FILE" 2>/dev/null; then
      printf 'boot %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMPOSE_PROJECT_NAME" "$CONTAINER_ID" >> "$EVENTS_FILE" 2>/dev/null || true
    fi
    write_state_file
  fi
fi
