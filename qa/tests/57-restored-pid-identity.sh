#!/usr/bin/env bash
# Test: a restored headless-registry pid is verified by start time before any
# signal (POSIX: darwin `ps lstart`, linux `/proc`).
#
# test-plan #X9: a REAL decoy started now, seeded as an 8-day-old entry (a pid
#   recycled while the server was down) → `identity mismatch … kind=spawn`,
#   entry dropped, decoy never signalled (pre-change the 7-day kill took it).
# test-plan #X10: a genuine orphan (entry newer than the decoy's start) is
#   still reclaimed at startup and killed by `killAll` on stop.
#
# Runs the REAL registry + platform probe (qa/tests/lib/restored-pid-identity-probe.ts).
# See change: guard-restored-headless-identity.
set -euo pipefail

echo "=== Test: restored headless pid identity (POSIX) ==="
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

probe() { QA_CASE="$1" npx --yes tsx qa/tests/lib/restored-pid-identity-probe.ts | grep '^{' | tail -1; }
get() { node -e "const j=JSON.parse(process.argv[1]);process.stdout.write(String(eval('j.'+process.argv[2])))" "$1" "$2"; }

OUT=$(probe recycled); echo "$OUT"
[ "$(get "$OUT" aliveAfterCleanup)" = "true" ] || { echo "FAIL X9: recycled decoy was signalled at startup"; exit 1; }
[ "$(get "$OUT" aliveAfterKillAll)" = "true" ] || { echo "FAIL X9: recycled decoy was signalled by killAll"; exit 1; }
[ "$(get "$OUT" 'afterCleanup.filePids.length')" = "0" ] || { echo "FAIL X9: recycled 8-day entry still in the pid file"; exit 1; }
get "$OUT" 'logs.join("\n")' | grep -q "identity mismatch pid=.* kind=spawn" || { echo "FAIL X9: no identity mismatch log"; exit 1; }
echo "X9: recycled pid refused, logged, never signalled"

OUT=$(probe genuine); echo "$OUT"
[ "$(get "$OUT" 'afterCleanup.size')" = "1" ] || { echo "FAIL X10: genuine orphan not reclaimed"; exit 1; }
[ "$(get "$OUT" aliveAfterCleanup)" = "true" ] || { echo "FAIL X10: genuine orphan killed at startup (not 7 days old)"; exit 1; }
[ "$(get "$OUT" aliveAfterKillAll)" = "false" ] || { echo "FAIL X10: genuine orphan survived killAll on stop"; exit 1; }
echo "X10: genuine orphan reclaimed, then killed on stop"
echo "PASS"
