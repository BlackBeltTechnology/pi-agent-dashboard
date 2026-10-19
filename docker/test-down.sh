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

# ---------------------------------------------------------------- lifecycle marker
# #451 part 1 (change: add-missing-ci-legs, design D7). Mark THIS teardown in the
# project's lifecycle record BEFORE removing anything, so a `destroy` line for
# this boot's container that is NOT preceded by this marker is attributable to a
# foreign actor. Everything is matched by container ID (the project name is
# stable across boots). A lost or never-started recorder never fails a teardown:
# one warning, marker still written when the file is writable, no wait.
state_field() { # <field> — scalar field of the state file ("" when absent)
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/.*\"$1\"[: ]*\"\{0,1\}\([^\",} ]*\).*/\1/p" "$STATE_FILE" | head -1
}
RECORDER_PID="$(state_field recorderPid)"
EVENTS_FILE="$(state_field eventsFile)"
CONTAINER_ID="$(state_field containerId)"
if [ -z "$EVENTS_FILE" ]; then
  EVENTS_FILE="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/pi-dash-test/${project}.events.log"
fi
if [ -z "$CONTAINER_ID" ]; then
  # Attached boot (state has no ID): resolve it now, before compose removes it.
  # Name the service: an overlay (TEST_EXTRA_COMPOSE) adds sibling containers.
  CONTAINER_ID="$(docker compose -p "$project" ps -aq pi-dashboard 2>/dev/null | head -1 || true)" # -a: an attached run stopped by Ctrl-C leaves a stopped container
fi

# Alive AND still our recorder: a recycled PID (the state file often outlives a
# dead recorder) must never be signalled.
recorder_alive() {
  [[ "$RECORDER_PID" =~ ^[0-9]+$ ]] && kill -0 "$RECORDER_PID" 2>/dev/null \
    && ps -p "$RECORDER_PID" -o command= 2>/dev/null | grep -q 'harness-audit\.sh'
}
RECORDER_WAS_ALIVE=0
if recorder_alive; then
  RECORDER_WAS_ALIVE=1
else
  echo "harness-audit: lifecycle recorder is not running at teardown (pid ${RECORDER_PID:-none}); continuing" >&2
fi
printf 'teardown-begin %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$project" "$CONTAINER_ID" >> "$EVENTS_FILE" 2>/dev/null || true

# Extra overlays test-up.sh layered (TEST_EXTRA_COMPOSE) — read from the state
# file's `extraCompose`, so a teardown WITHOUT the env var (ship-it's trap) still
# names the overlay's services. State absent/unreadable, or written before the
# key existed → include every compose.test.*.yml and say so. --remove-orphans
# catches anything the file list still misses. See change: add-acme-dns01-certs.
COMPOSE_FILES=(-f "${SCRIPT_DIR}/compose.yml" -f "${SCRIPT_DIR}/compose.test.yml")
extra_list=""
if [ -f "$STATE_FILE" ] && grep -q '"project"' "$STATE_FILE" 2>/dev/null \
  && grep -q '"extraCompose"' "$STATE_FILE" 2>/dev/null; then
  extra_list="$(sed -n 's/.*"extraCompose"[: ]*\[\([^]]*\)\].*/\1/p' "$STATE_FILE" | head -1 | tr -d '",')"
else
  for f in "${SCRIPT_DIR}"/compose.test.*.yml; do
    [ -f "$f" ] && extra_list="${extra_list} $(basename "$f")"
  done
  echo "add-acme-dns01-certs: no readable extraCompose in .pi-test-harness.json; falling back to every compose.test.*.yml:${extra_list:- (none)}" >&2
fi
for f in $extra_list; do
  case "$f" in */*|"") continue ;; esac # basenames under docker/ only
  [ -f "${SCRIPT_DIR}/${f}" ] && COMPOSE_FILES+=(-f "${SCRIPT_DIR}/${f}")
done

down_status=0
docker compose -p "$project" "${COMPOSE_FILES[@]}" \
  down -v --remove-orphans "$@" || down_status=$?

# The event stream is asynchronous: stopping the recorder at once could drop the
# very `destroy` line that tells own teardown from a foreign destroy. Wait (<=10 s)
# for THAT container's destroy line, then stop the recorder.
if [ "$RECORDER_WAS_ALIVE" = "1" ]; then
  if [ -n "$CONTAINER_ID" ]; then
    # PI_HARNESS_DESTROY_WAIT_SECS: tests inject a short wait; the default is 10 s.
    for _ in $(seq 1 $(( ${PI_HARNESS_DESTROY_WAIT_SECS:-10} * 5 ))); do
      grep -q " destroy .* id=${CONTAINER_ID}\$" "$EVENTS_FILE" 2>/dev/null && break
      sleep 0.2
    done
  fi
  kill "$RECORDER_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$RECORDER_PID" 2>/dev/null || break
    sleep 0.1
  done
fi
[ -f "$EVENTS_FILE" ] && echo "harness-audit: lifecycle events: ${EVENTS_FILE}"
if [ "$down_status" -ne 0 ]; then
  exit "$down_status"
fi

# Drop the per-worktree state file after a successful down.
rm -f "$STATE_FILE"

# Remove this worktree's baked image so per-worktree tags don't accumulate.
# Runs AFTER down -v (no container references it). Best-effort/non-fatal: a
# missing tag (never built, or already pruned) must not fail teardown. Targets
# only THIS worktree's tag via the CWD-derived project name; never the base
# pi-dashboard:local. See change fix-parallel-e2e-docker-collisions D4.
docker image rm -f "pi-dashboard:${project}" 2>/dev/null || true
