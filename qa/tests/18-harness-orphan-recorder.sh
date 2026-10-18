#!/usr/bin/env bash
# L2 smoke: an ORPHANED lifecycle recorder ends by itself (test-plan P1; change:
# add-missing-ci-legs, #451 part 1). An interrupted run never reaches
# test-down.sh, so the recorder must self-terminate once its container is gone.
#
# Real Docker daemon, minimal container. The recorder runs with the DEFAULT 30 s
# poll, exactly as docker/test-up.sh launches it. `docker rm -f` removes the
# container with no test-down.sh; the recorder PID must be gone within 30 s of
# the poll + 5 s slack, inside a 40 s window.
#
# Usage: qa/tests/18-harness-orphan-recorder.sh   (QA_MINIMAL_IMAGE=alpine:3.20)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMG="${QA_MINIMAL_IMAGE:-alpine:3.20}"
WINDOW_SECS=40
fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "  $*"; }

command -v docker >/dev/null || fail "docker not found"
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull -q "$IMG" >/dev/null
# shellcheck source=docker/lib-ports.sh
source "$REPO_ROOT/docker/lib-ports.sh"

ROOT="$(mktemp -d)"
PROJ="$(derive_project "$ROOT")"
EV="$ROOT/$PROJ.events.log"
REC=""
cleanup() {
  [ -n "$REC" ] && kill "$REC" 2>/dev/null || true
  docker rm -f "${PROJ}-pi-dashboard-1" >/dev/null 2>&1 || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

: > "$EV"
"$REPO_ROOT/docker/harness-audit.sh" "$EV" "$PROJ" >/dev/null 2>&1 &
REC=$!
sleep 1
docker run -d --name "${PROJ}-pi-dashboard-1" \
  --label "com.docker.compose.project=${PROJ}" \
  --label "com.docker.compose.service=pi-dashboard" \
  --label "com.docker.compose.oneoff=False" \
  "$IMG" sleep 600 >/dev/null
sleep 2
kill -0 "$REC" 2>/dev/null || fail "recorder died before the container was removed"
grep -q "^boot " "$EV" || fail "recorder did not observe the container (no boot line)"
info "recorder $REC armed (observed its container)"

docker rm -f "${PROJ}-pi-dashboard-1" >/dev/null   # foreign destroy, NO test-down.sh
start="$(date +%s)"
while kill -0 "$REC" 2>/dev/null; do
  elapsed=$(( $(date +%s) - start ))
  [ "$elapsed" -le "$WINDOW_SECS" ] || fail "orphaned recorder still alive ${elapsed}s after its container was removed (limit 35 s, window ${WINDOW_SECS} s)"
  sleep 1
done
elapsed=$(( $(date +%s) - start ))
[ "$elapsed" -le 35 ] || fail "recorder took ${elapsed}s (> 30 s poll + 5 s slack)"
grep -q " destroy " "$EV" || fail "the destroy line was not recorded"
REC=""
echo "PASS: orphaned recorder self-terminated in ${elapsed}s"
