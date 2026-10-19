#!/usr/bin/env bash
# L2 smoke: harness teardown removes the ACME overlay (test-plan X12; change:
# add-acme-dns01-certs, design D10). ship-it's trap runs docker/test-down.sh
# WITHOUT TEST_EXTRA_COMPOSE, so teardown must read the overlay list from the
# harness state file — and, with the state file gone, fall back to every
# docker/compose.test.*.yml and say so. Overlay containers never survive.
#
# Real Docker daemon. Run 1: up with TEST_EXTRA_COMPOSE=compose.test.acme.yml,
# down with the env var unset. Run 2: same, state file deleted before down.
# Both: `docker ps -a` for the project lists no pebble / challtestsrv / cf-shim /
# acme-dns container; run 2 logs the fallback line.
#
# Usage: qa/tests/46-harness-acme-overlay-teardown.sh
#   QA_HARNESS_IMAGE  optional existing image, tagged pi-dashboard:<project>
#                     before each up instead of `--build` (teardown does not care
#                     what the image runs; test-down.sh removes the tag again)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "  $*"; }

command -v docker >/dev/null || fail "docker not found"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable"
# shellcheck source=docker/lib-ports.sh
source "$REPO_ROOT/docker/lib-ports.sh"

cd "$REPO_ROOT" # the harness project is derived from $PWD
PROJ="$(derive_project "$PWD")"
STATE="$PWD/.pi-test-harness.json"
LOG="$(mktemp)"
OVERLAY_RE='(pebble|challtestsrv|cf-shim|acme-dns)'

cleanup() {
  TEST_EXTRA_COMPOSE=compose.test.acme.yml "$REPO_ROOT/docker/test-down.sh" >/dev/null 2>&1 || true
  rm -f "$LOG"
}
trap cleanup EXIT

if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=${PROJ}")" ]; then
  fail "harness project ${PROJ} already has containers — tear it down first (docker/test-down.sh)"
fi

overlay_left() { # prints any overlay container still listed for the project
  docker ps -a --filter "label=com.docker.compose.project=${PROJ}" --format '{{.Names}}' | grep -E "$OVERLAY_RE" || true
}

up_overlay() {
  local up_args=(-d --build)
  if [ -n "${QA_HARNESS_IMAGE:-}" ]; then
    docker tag "$QA_HARNESS_IMAGE" "pi-dashboard:${PROJ}" || fail "cannot tag ${QA_HARNESS_IMAGE}"
    up_args=(-d)
  fi
  TEST_EXTRA_COMPOSE=compose.test.acme.yml "$REPO_ROOT/docker/test-up.sh" "${up_args[@]}" >"$LOG" 2>&1 \
    || { tail -30 "$LOG" >&2; fail "test-up.sh with the ACME overlay failed"; }
  local names
  names="$(docker ps -a --filter "label=com.docker.compose.project=${PROJ}" --format '{{.Names}}')"
  for svc in pebble challtestsrv cf-shim acme-dns; do
    printf '%s\n' "$names" | grep -q -- "-${svc}-" || fail "overlay service ${svc} was not created (got: ${names//$'\n'/ })"
  done
  grep -q '"extraCompose": \["compose.test.acme.yml"\]' "$STATE" || fail "state file does not record the overlay: $(cat "$STATE")"
  info "overlay up (pebble, challtestsrv, cf-shim, acme-dns); state records extraCompose"
}

# ── Run 1: state file present, env var unset ───────────────────────────────
up_overlay
env -u TEST_EXTRA_COMPOSE "$REPO_ROOT/docker/test-down.sh" >"$LOG" 2>&1 || { cat "$LOG" >&2; fail "test-down.sh (run 1) failed"; }
left="$(overlay_left)"
[ -z "$left" ] || fail "run 1: overlay containers survived teardown: ${left//$'\n'/ }"
grep -q "falling back to every compose.test" "$LOG" && fail "run 1: fallback logged although the state file was present"
info "run 1: no overlay container left (state-file list)"

# ── Run 2: state file deleted, env var unset ───────────────────────────────
up_overlay
rm -f "$STATE"
env -u TEST_EXTRA_COMPOSE "$REPO_ROOT/docker/test-down.sh" >"$LOG" 2>&1 || { cat "$LOG" >&2; fail "test-down.sh (run 2) failed"; }
grep -q "falling back to every compose.test.\*.yml" "$LOG" || { cat "$LOG" >&2; fail "run 2: fallback line not logged"; }
left="$(overlay_left)"
[ -z "$left" ] || fail "run 2: overlay containers survived teardown: ${left//$'\n'/ }"
info "run 2: fallback logged, no overlay container left"

echo "PASS: ACME overlay removed by test-down.sh in both runs"
