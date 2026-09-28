#!/usr/bin/env bash
# Test: a RETAINED remote transcript's hydration must not block the event loop.
#
#   P1 — the shipped (offloaded) path. Cold-hydrates a 44 MB retained transcript
#        through the REAL session-load worker pool and asserts the longest
#        contiguous main-thread block stays under 250 ms, read off
#        `monitorEventLoopDelay`. 44 MB is the observed maximum across 3471
#        local transcripts (p50 73 KB, p90 1.1 MB, p99 3.9 MB, max 44.1 MB) —
#        the number the retention cap was sized against.
#   P2 — the PRE-change baseline. The same bytes through the synchronous
#        composition the offload replaced (`readFileSync` + split + parse +
#        replay), RECORDED and never asserted. This is the number the revert
#        gate compares against: a change justified by a latency budget that
#        does not move it should be reverted, not kept.
#
# OPT-IN: not in run-all.sh. It builds a ~44 MB fixture per run and is
# timing-sensitive, so it has no place in the default suite. It also lives
# outside `packages/server/src/**/__tests__/` deliberately — a `.test.ts` there
# would be collected by the always-on vitest project and pay that fixture on
# every `npm test`.
#
# RUNTIME: the measurement imports the server's TypeScript, which needs jiti.
# Worktrees frequently carry an INCOMPLETE node_modules (this repo's own
# `worktreeInit` hook may not have run), so this script resolves a runtime in
# order and never pretends to have measured anything:
#
#   1. `node_modules/jiti/lib/jiti-register.mjs` in the repo — run locally.
#   2. a running docker harness container (`docker/test-up.sh`) — `docker
#      exec` the same script inside it. This is the strong arm: a real install,
#      a real worker thread.
#   3. otherwise SKIP with the reason, exiting 0 only because a missing runtime
#      is an environment problem, not a regression. Treat a SKIP as unverified.
#
# See change: offload-retained-transcript-replay (test-plan #P1, #P2).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PERF_SCRIPT="packages/server/perf/retained-hydration-block.mjs"
JITI_REGISTER="node_modules/jiti/lib/jiti-register.mjs"

echo "=== Test: retained hydration event-loop block (P1, P2) ==="

if [ -f "$REPO_ROOT/$JITI_REGISTER" ]; then
  echo "runtime: local node + jiti"
  cd "$REPO_ROOT"
  node --import "./$JITI_REGISTER" "./$PERF_SCRIPT"
  exit $?
fi

HARNESS_JSON="$REPO_ROOT/.pi-test-harness.json"
if [ -f "$HARNESS_JSON" ] && command -v docker >/dev/null 2>&1; then
  project="$(sed -n 's/.*"project": *"\([^"]*\)".*/\1/p' "$HARNESS_JSON")"
  cid="$(docker ps -q --filter "label=com.docker.compose.project=$project" 2>/dev/null | head -1)"
  if [ -n "$cid" ]; then
    echo "runtime: docker harness container $cid ($project)"
    # The harness runs an overlay of this worktree taken when it came up, so a
    # file added since then is absent from /app. Copy it in (idempotent) rather
    # than forcing a rebuild. The SERVER sources it imports are already there.
    docker exec "$cid" mkdir -p "/app/$(dirname "$PERF_SCRIPT")" 2>/dev/null
    docker cp "$REPO_ROOT/$PERF_SCRIPT" "$cid:/app/$PERF_SCRIPT" >/dev/null
    docker exec "$cid" node --import "/app/$JITI_REGISTER" "/app/$PERF_SCRIPT"
    exit $?
  fi
  echo "runtime: harness file present but no container for $project is running"
fi

echo "SKIP: no runtime can load the server's TypeScript."
echo "  This worktree has no $JITI_REGISTER (incomplete node_modules)."
echo "  Run the repo's worktreeInit hook, or bring up the docker harness"
echo "  (docker/test-up.sh -d) and re-run this script. P1 is UNVERIFIED."
exit 0
