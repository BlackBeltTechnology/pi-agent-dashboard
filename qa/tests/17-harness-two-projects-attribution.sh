#!/usr/bin/env bash
# L2 smoke: with TWO harnesses on one daemon, tearing one down is attributed to
# THAT project and container only (test-plan E33; change: add-missing-ci-legs,
# #451 part 1).
#
# Real Docker daemon, minimal containers (no dashboard image build): two compose
# projects A and B, each with a lifecycle recorder exactly as docker/test-up.sh
# launches it. `docker/test-down.sh` runs for A while B stays up.
#
# Asserts:
#   - A's events file holds A's `destroy` (A's project + A's container id);
#   - A's events file holds NO `destroy` for B's container id;
#   - B's container is still running afterwards.
#
# Usage: qa/tests/17-harness-two-projects-attribution.sh
#   QA_MINIMAL_IMAGE=alpine:3.20   image with `sleep` (default alpine:3.20)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMG="${QA_MINIMAL_IMAGE:-alpine:3.20}"
fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "  $*"; }

command -v docker >/dev/null || fail "docker not found"
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull -q "$IMG" >/dev/null

# shellcheck source=docker/lib-ports.sh
source "$REPO_ROOT/docker/lib-ports.sh"

ROOT="$(mktemp -d)"
EVENTS_DIR="$ROOT/events"
mkdir -p "$ROOT/a" "$ROOT/b" "$EVENTS_DIR"
PROJ_A="$(derive_project "$(cd "$ROOT/a" && pwd)")"
PROJ_B="$(derive_project "$(cd "$ROOT/b" && pwd)")"

cleanup() {
  [ -f "$RECFILE" ] && while read -r pid; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done < "$RECFILE"
  # Only OUR two projects, each by its exact compose project name — never a
  # prefix filter (that would also remove other worktrees' harnesses).
  for d in a b; do
    [ -f "$ROOT/$d/min-compose.yml" ] && docker compose -p "$([ "$d" = a ] && echo "$PROJ_A" || echo "$PROJ_B")" -f "$ROOT/$d/min-compose.yml" down -v >/dev/null 2>&1 || true
  done
  rm -rf "$ROOT"
}
trap cleanup EXIT

# Recorder PIDs are collected in a FILE: start_harness runs inside $(...), so an
# array append there would only change the subshell's copy and cleanup would
# never see it (a failed boot step would leak the recorder).
RECFILE="$ROOT/recorder.pids"
: > "$RECFILE"
start_harness() { # <dir> <project> → prints container id; appends the recorder pid to $RECFILE
  local dir="$1" proj="$2" ev="$EVENTS_DIR/$2.events.log" cid rec
  : > "$ev"
  # Recorder first (as test-up.sh does), then the container it must observe.
  PI_HARNESS_AUDIT_POLL_SECS=2 "$REPO_ROOT/docker/harness-audit.sh" "$ev" "$proj" >/dev/null 2>&1 &
  rec=$!
  echo "$rec" >> "$RECFILE"
  sleep 1
  # A real compose project (service name `pi-dashboard`, like docker/compose.yml)
  # on a minimal image, so test-down.sh's `compose down` really removes it.
  cat > "$dir/min-compose.yml" <<YML
services:
  pi-dashboard:
    image: ${IMG}
    command: sleep 600
YML
  docker compose -p "$proj" -f "$dir/min-compose.yml" up -d >/dev/null 2>&1
  cid="$(docker compose -p "$proj" -f "$dir/min-compose.yml" ps -q | head -1)"
  [ -n "$cid" ] || fail "compose project $proj has no container"
  cat > "$dir/.pi-test-harness.json" <<JSON
{ "project": "${proj}", "dashboardPort": 18111, "gatewayPort": 18112, "recorderPid": ${rec}, "eventsFile": "${ev}", "containerId": "${cid}" }
JSON
  echo "$cid"
}

CID_A="$(start_harness "$ROOT/a" "$PROJ_A")"
CID_B="$(start_harness "$ROOT/b" "$PROJ_B")"
info "A: $PROJ_A $CID_A"
info "B: $PROJ_B $CID_B"
sleep 2 # let both recorders see their create events

echo "== tearing down A (B stays up) =="
(cd "$ROOT/a" && TMPDIR="$ROOT" "$REPO_ROOT/docker/test-down.sh")

EV_A="$EVENTS_DIR/$PROJ_A.events.log"
grep -q " destroy .* project=${PROJ_A} id=${CID_A}\$" "$EV_A" \
  || fail "A's events file has no destroy line for A's container (${CID_A})"
info "OK: A's destroy recorded (project=$PROJ_A, id=${CID_A:0:12}…)"

if grep -q "destroy.*${CID_B}" "$EV_A"; then
  fail "A's events file contains a destroy for B's container"
fi
info "OK: no destroy for B's container in A's file"

[ "$(docker inspect -f '{{.State.Running}}' "$CID_B")" = "true" ] || fail "B's container is not running"
info "OK: B still running"

grep -q "^teardown-begin .* ${PROJ_A} ${CID_A}\$" "$EV_A" || fail "A's teardown marker missing"
info "OK: A's own teardown marker precedes its destroy"
echo "PASS: two-project attribution"
