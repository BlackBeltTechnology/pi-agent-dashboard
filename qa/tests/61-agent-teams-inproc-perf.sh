#!/usr/bin/env bash
# Test: agent-teams IN-PROCESS mode — performance, memory and shared-process-risk rows (L2). OPT-IN (PI_QA_INPROC_PERF=1):
# minutes of wall clock (spawn cycles, a soak, a 400 s starvation), so it is not in run-all.sh's TESTS list.
# See change: add-agent-teams-in-process (test-plan #S97 = 13.1, #S98 = 13.2, #S100 = 13.3, #S101 = 13.4).
#
# These rows are specified against the REAL upstream package (`⟦upstream⟧`, gate task 1.11). Two modes, chosen here and printed
# on every section:
#   upstream  QA_SUBAGENTS_PKG_DIR names a `pi-dashboard-subagents` >= 0.9.0 that answers `subagents:capabilities`: the package
#             is registered in the hermetic prefix and the lead runs WITHOUT the fake. Full rows (lean in {false,true}, per-child heap).
#   fixture   otherwise (a visible NOTE names the reason): the FAKE subagents extension (qa/fixtures/fake-subagents.ext.ts, `pi -e`
#             on the lead only). It proves the dashboard-side plumbing only; each section prints what it still measures and what
#             it cannot (child boot cost, loader/lean, per-child heap). Never reported as the upstream result.
#
#   spawn  (#S97)  10 sequential spawns, spawn->started median in-process <= 50 % of the session-mode median of the same run;
#                  cold vs warm recorded. fixture: plumbing regression guard only; the lean arm is skipped (no loader in the fake).
#   memory (#S98)  4 idle children then busy under mail bursts: heap per idle child + lead heap slope REPORT-ONLY until a baseline
#                  (QA_INPROC_BASELINE_FILE), then ratcheted (<= 1.5x); mail/snapshot stay bounded. Internal registry/outbox/ledger
#                  sizes are not observable here (L1 covers them).
#   lag    (#S100) 4 busy children streaming: 0 spurious lead_ended; event-loop gap reported, hard ceiling QA_INPROC_LAG_HARD_MS.
#   starve (#S101) fixture only: a child blocks the lead loop for 400 s (> 2x the 180 s heartbeat timeout): team closed lead_ended,
#                  lead survives, queued best-effort stops delivered after its next hello, no child left running. SKIPs in upstream mode.
#
# Hermetic: own prefix (HOME), own port (default 18981). Inputs are those of dist-only-lib.sh plus
#   QA_INPROC_PERF_SECTIONS "spawn memory lag starve" (default all) · QA_SUBAGENTS_PKG_DIR · QA_INPROC_SPAWN_N (10) ·
#   QA_INPROC_MEM_BUSY_S (120; spec 600) · QA_INPROC_MAIL_BURSTS (3) · QA_INPROC_LAG_S (120; spec 1800) · QA_INPROC_LAG_HARD_MS (10000)
#   QA_INPROC_BASELINE_FILE / QA_INPROC_RECORD_BASELINE (ratchet baseline, decision A12) · QA_REPO_ROOT
# SKIPs (`SKIP:` first line + exit 0) unless PI_QA_INPROC_PERF=1, and without `pi` or a checkout with the fixtures.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPT_IN="${PI_QA_INPROC_PERF:-}" # read BEFORE the hermetic unset of PI_* below
REPO_ROOT="${QA_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
FIXTURE_DIR="$REPO_ROOT/qa/fixtures"
FAKE_EXT="$FIXTURE_DIR/fake-subagents.ext.ts"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"
# shellcheck source=agent-teams-inproc-lib.sh
. "$HERE/agent-teams-inproc-lib.sh"

if [ "$OPT_IN" != "1" ]; then
  echo "SKIP: opt-in (set PI_QA_INPROC_PERF=1): minutes of spawn cycles, soak and a 400 s starvation (test-plan #S97, #S98, #S100, #S101)"
  exit 0
fi

# Hermetic: see 60-agent-teams-inproc-persistence.sh.
for v in $(compgen -e | grep -E '^(PI_|DASHBOARD_STARTER$)' || true); do unset "$v"; done

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (the in-process perf rows need a real pi lead)"
  exit 0
fi
for f in "$FAKE_EXT" "$FIXTURE_DIR/faux-provider.ext.ts" "$FIXTURE_DIR/faux-scenarios.ts" "$HERE/lib/agent-teams-inproc-perf.cjs" "$HERE/lib/agent-teams-inproc-drive.cjs"; do
  if [ ! -f "$f" ]; then
    echo "SKIP: $f not found (needs a checkout with qa/fixtures and the packages; set QA_REPO_ROOT)"
    exit 0
  fi
done

SECTIONS="${QA_INPROC_PERF_SECTIONS:-spawn memory lag starve}"

UPSTREAM=0
if REASON=$(ati_upstream_reason); then
  UPSTREAM=1
  MODE_NOTE="upstream: real pi-dashboard-subagents at $QA_SUBAGENTS_PKG_DIR"
else
  MODE_NOTE="fixture: the REAL upstream package is absent ($REASON); rows run against the fake subagents extension where meaningful"
fi

do_init agent-teams-inproc-perf 18981
do_banner
echo "NOTE: $MODE_NOTE"
echo "sections: $SECTIONS"
do_install
do_config_port
ati_stage_faux "$PREFIX" "$FIXTURE_DIR"
[ "$UPSTREAM" = "1" ] && ati_register_upstream "$PREFIX"
do_boot || do_fail "/api/health never answered 200 on :$PORT"

PROBE=$(do_cli api GET /api/plugins/agent-teams/teams --port "$PORT" 2>/dev/null || true)
printf '%s' "$PROBE" | grep -q '"teams"' || do_fail "agent-teams plugin routes are not available on :$PORT (plugin not loaded)"

PATH="$BIN_DIR:$PATH" HOME="$PREFIX" \
  QA_BASE="$BASE" QA_PORT_NODE="$PORT" QA_FAKE_EXT="$FAKE_EXT" QA_SCRATCH="$SCRATCH" QA_UPSTREAM="$UPSTREAM" \
  QA_INPROC_PERF_SECTIONS="$SECTIONS" \
  node "$HERE/lib/agent-teams-inproc-perf.cjs" || do_fail "in-process perf sections failed (see above)"

echo "PASS: agent-teams in-process perf ($SECTIONS, $([ "$UPSTREAM" = "1" ] && echo upstream || echo fixture))"
