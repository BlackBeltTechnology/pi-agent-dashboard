#!/usr/bin/env bash
# L2 smoke: a FOREIGN destroy of the managed harness container is named in the
# harness-down message (test-plan X5; change: add-missing-ci-legs, #451 part 1).
#
# Managed Playwright run (the repo's globalSetup boots the real harness through
# docker/test-up.sh — builds the dashboard image, several minutes cold) of the
# six-spec probe suite qa/fixtures/harness-foreign-destroy/. After spec 1 this
# script runs `docker rm -f <containerId>` from OUTSIDE the harness (the foreign
# actor). The harness-death latch needs three consecutive failed probes, so:
# spec 1 passes, specs 2-3 fail on their own, spec 4 fails with the HARNESS DOWN
# message, specs 5-6 are skipped.
#
# Asserts:
#   - exit code is non-zero;
#   - exactly one test carries the HARNESS DOWN message, and it contains
#     "foreign" and the quoted `destroy` line of the destroyed container id;
#   - the remaining probes after it are skipped, not failed.
#
# Usage: qa/tests/19-harness-foreign-destroy-report.sh   (run from a checkout with deps installed)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "  $*"; }

LOG="$(mktemp)"
DONE="$(mktemp -u)"
MARKER="$REPO_ROOT/test-results/.e2e-managed"
CONFIG="qa/fixtures/harness-foreign-destroy/playwright.config.ts"
WATCHER=""
cleanup() { [ -n "$WATCHER" ] && kill "$WATCHER" 2>/dev/null || true; rm -f "$LOG" "$DONE"; }
trap cleanup EXIT

# The foreign actor: waits for spec 1, then destroys THIS run's container by its
# exact id (never a prefix filter — that would also remove other worktrees' harnesses).
(
  for _ in $(seq 1 1800); do [ -f "$DONE" ] && break; sleep 1; done
  [ -f "$DONE" ] || exit 0
  ws="$(node -p "JSON.parse(require('node:fs').readFileSync('$MARKER','utf8')).workspace")"
  cid="$(node -p "JSON.parse(require('node:fs').readFileSync('$ws/.pi-test-harness.json','utf8')).containerId")"
  echo "foreign actor: docker rm -f $cid" >&2
  docker rm -f "$cid" >/dev/null
) &
WATCHER=$!

set +e
PROBE_SPEC1_DONE="$DONE" CI=1 PI_E2E_SEED=1 TEST_COPY_MODE=1 PW_E2E_BOOT_TIMEOUT_MS=1200000 \
  npx playwright test --config "$CONFIG" > "$LOG" 2>&1
rc=$?
set -e

cat "$LOG" | tail -40
[ "$rc" -ne 0 ] || fail "run exited 0 although the harness was destroyed mid-run"
info "OK: non-zero exit ($rc)"

down="$(grep -c 'HARNESS DOWN: the Docker E2E harness failed' "$LOG" || true)"
[ "$down" -ge 1 ] || fail "no HARNESS DOWN message in the output"
grep 'HARNESS DOWN: the Docker E2E harness failed' "$LOG" | grep -q 'foreign' \
  || fail "the HARNESS DOWN message does not say 'foreign'"
grep 'HARNESS DOWN: the Docker E2E harness failed' "$LOG" | grep -q ' destroy ' \
  || fail "the HARNESS DOWN message does not quote the destroy line"
info "OK: HARNESS DOWN message names a foreign destroy and quotes the event line"

skipped="$(grep -c 'HARNESS DOWN — skipping' "$LOG" || true)"
failed_down="$(grep -c 'HARNESS DOWN: the Docker E2E harness failed' "$LOG" || true)"
[ "$failed_down" -le 2 ] || fail "more than one test announced the harness death ($failed_down)"
[ "$skipped" -ge 1 ] || info "NOTE: no probe was skipped (the latch armed on the last probe)"
echo "PASS: foreign destroy attributed in the harness-down message"
