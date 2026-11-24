#!/usr/bin/env bash
# Test: agent-teams core — restart mid-team, lead resume, `/new` replacement (L2).
#
# SKELETON (change: add-agent-teams-core, task 1.15). The three scenarios below
# are filled in by the runtime sections of that change; until then the script
# SKIPs cleanly (SKIP: first line + exit 0, the convention of 10-faux-model.sh)
# so it never red-fails run-all.sh. Each block names its test-plan row.
#
#   S76  runtime: hello after restart — real server restart mid-team (faux-model
#        sessions, plugin loaded), teammate bridge reconnects ⇒ member status ==
#        reported isIdle, unacked mail delivered exactly once, 0 duplicate
#        claims, tasks unchanged.
#   S85  runtime: lead resume — lead session resumed from its session file after
#        pi restart ⇒ team orphaned→active within TTL, lead tool set
#        re-registered, dispatch resumes.
#   S87  scope: session replaced — teammate process runs `/new` (id changes) ⇒
#        old id gone, binding follows the replacement rules.
#
# Sessions are real `pi --mode rpc` processes driven by the faux fixture
# (qa/fixtures/faux-provider.ext.ts), as in 10-faux-model.sh / 53-bridge-session-replacement.sh.
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (agent-teams core smoke requires pi installed)"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURE="$REPO_ROOT/qa/fixtures/faux-provider.ext.ts"

if [ ! -f "$FIXTURE" ]; then
  echo "FAIL: fixture not found at $FIXTURE"
  exit 1
fi

# TODO(add-agent-teams-core 2.x–9.x): implement S76, S85, S87 against the live
# dashboard (derive the port from QA env; `pi-dashboard api` for authenticated
# REST) and replace this SKIP with PASS/FAIL.
echo "SKIP: agent-teams core L2 scenarios S76/S85/S87 not implemented yet (skeleton)"
exit 0
