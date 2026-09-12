#!/usr/bin/env bash
# Test: /remove-batch per-item latency, filled to the CONFIGURED cap.
#
# Folded from test-plan.md (apply-checkout-root-to-worktree-ops): P2.
#
# Each item is a synchronous, blocking removal on the event loop, so one HTTP
# request costs cap × per-item latency. The budget is PER ITEM and
# cap-independent — never expressed against a fixed 50, because the cap is
# configuration (DashboardConfig.removeBatchCap). The script discovers the
# effective cap by probing the endpoint: the `batch_too_large` rejection
# message names it.
#
# The batch is filled with REAL worktrees (git worktree add), so the measured
# wall-clock is real removal work, not refusal short-circuits. 5 repetitions;
# p95 of the per-item means must stay under 100 ms.
#
# Target selection:
#   - default: the LOCAL dashboard on :8000 (or PI_QA_PORT) — the repo lives
#     on this host, git runs here.
#   - PI_QA_DOCKER_CONTAINER=<name>: the dashboard runs in that container
#     (the docker e2e harness). The repo + worktrees are then created INSIDE
#     the container, because host paths do not exist there (the server's
#     `validateCwd` would refuse every item with `cwd_invalid`).
set -euo pipefail

echo "=== Test: worktree remove-batch per-item latency (P2) ==="

PORT="${PI_QA_PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
REPS=${PI_QA_BATCH_REPS:-5}
BUDGET_MS_PER_ITEM=100
CONTAINER="${PI_QA_DOCKER_CONTAINER:-}"

if [ -n "$CONTAINER" ]; then
  # Run git / fs commands inside the target container.
  gitrun() { docker exec "$CONTAINER" sh -c "$*"; }
else
  gitrun() { sh -c "$*"; }
fi

if ! curl -fsS --max-time 15 --connect-timeout 5 "${BASE}/api/health" >/dev/null 2>&1; then
  echo "SKIP: no dashboard server on ${BASE} (start one, or set PI_QA_PORT)"
  exit 0
fi

WORK_DIR="/tmp/batch-perf-$(date +%s)-$$"
TEST_DIR="$WORK_DIR/repo"
if [ -n "$CONTAINER" ]; then
  gitrun "mkdir -p $TEST_DIR"
else
  TEST_DIR="$(mktemp -d)/repo"
  mkdir -p "$(dirname "$TEST_DIR")"
fi
cleanup() {
  if [ -n "$CONTAINER" ]; then
    docker exec "$CONTAINER" sh -c "rm -rf $WORK_DIR" || true
  else
    rm -rf "$(dirname "$TEST_DIR")" || true
  fi
}
trap cleanup EXIT

gitrun "cd $TEST_DIR && git init -q -b main && git config user.email qa@test.com && git config user.name QA && echo test > README.md && git add . && git commit -qm init"

# ── Discover the CONFIGURED cap from the batch_too_large message ────────────
# 501 > every legal clamp value (REMOVE_BATCH_CAP_MAX = 500), so the probe
# always trips the rejection; the message states the effective cap.
PROBE_RESP=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"items\":[$(for i in $(seq 1 501); do printf '{"cwd":"%s"},' "$TEST_DIR"; done | sed 's/,$//')]}" \
  "${BASE}/api/git/worktree/remove-batch")
CAP=$(echo "$PROBE_RESP" | grep -oE 'at most [0-9]+ items per batch' | grep -oE '[0-9]+' || true)
if [ -z "$CAP" ]; then
  echo "FAIL: could not discover the effective batch cap from the batch_too_large message"
  echo "$PROBE_RESP"
  exit 1
fi
echo "Effective configured cap: ${CAP} items"

# ── Measure REPS batches, each filled to the cap with REAL worktrees ───────
MEANS_FILE="/tmp/batch-perf-means-$$"
: > "$MEANS_FILE"

for rep in $(seq 1 "$REPS"); do
  WT_DIR="$WORK_DIR/wts-$rep"
  paths_json=""
  for i in $(seq 1 "$CAP"); do
    wt="$WT_DIR/wt-$i"
    gitrun "cd $TEST_DIR && git worktree add -q --detach $wt" >/dev/null 2>&1
    if [ -n "$paths_json" ]; then paths_json="$paths_json,"; fi
    paths_json="$paths_json{\"cwd\":\"$wt\",\"force\":true}"
  done

  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  RESP=$(curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"items\":[$paths_json]}" \
    "${BASE}/api/git/worktree/remove-batch")
  end=$(python3 -c 'import time; print(int(time.time()*1000))')

  ok_count=$(echo "$RESP" | grep -o '"ok":true' | wc -l | tr -d ' ')
  if [ "$ok_count" -lt "$CAP" ]; then
    echo "FAIL: rep $rep removed only $ok_count of $CAP items"
    echo "$RESP" | head -c 500
    exit 1
  fi

  mean=$(( (end - start) / CAP ))
  echo "rep $rep: $CAP items, wall $((end - start)) ms, mean ${mean} ms/item"
  echo "$mean" >> "$MEANS_FILE"
done

# p95 over 5 reps = the max (conservative, small-n honest).
p95=$(sort -n "$MEANS_FILE" | tail -1)
rm -f "$MEANS_FILE"
echo "p95 per-item latency: ${p95} ms (budget ${BUDGET_MS_PER_ITEM} ms)"

# ── Diagnosability: the per-item cost is (probe budget × node-spawn floor)
# + one git remove (D7 accepts up to 5 sync spawns per item, no caching). A
# budget failure on a LOADED host is usually the spawn floor, not the code —
# print the floor so the reconciliation is visible.
if [ "$p95" -ge "$BUDGET_MS_PER_ITEM" ]; then
  FLOOR_DIR="$WORK_DIR/floor"
  gitrun "cd $TEST_DIR && mkdir -p $FLOOR_DIR"
  floor_start=$(python3 -c 'import time; print(int(time.time()*1000))')
  for i in $(seq 1 10); do gitrun "cd $TEST_DIR && git rev-parse --show-toplevel" >/dev/null; done
  floor_end=$(python3 -c 'import time; print(int(time.time()*1000))')
  floor=$(( (floor_end - floor_start) / 10 ))
  echo "diagnostic: environment git-spawn floor ≈ ${floor} ms/call; per-item ≈ 5 × floor + remove"
fi

if [ "$p95" -ge "$BUDGET_MS_PER_ITEM" ]; then
  echo "FAIL: per-item p95 ${p95}ms exceeds the ${BUDGET_MS_PER_ITEM}ms budget"
  exit 1
fi

echo "PASS: remove-batch per-item latency within budget (cap-independent assertion over ${REPS} reps)"
