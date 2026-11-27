#!/usr/bin/env bash
# Test: agent-teams IN-PROCESS mode — persistence and lead-lifecycle smoke (L2, process level).
# See change: add-agent-teams-in-process (test-plan #S103 = 13.5, #S104 = 13.6, #S105 = 13.7, #S106 = 13.8).
#
#   restart (#S103) a real server restart while two in-process children are busy: the lead pid is unchanged, the children
#                   continue and finish their one run each (exactly once), the team stays open, queued mail is flushed and acked.
#   reload  (#S104) the lead is reloaded (`/reload`, what `npm run reload` sends): team closed `lead_reloaded`, members gone
#                   `lead_reloaded`, tasks pending, ONE waking notice, no leaked child (the fake's upstream list is empty).
#   kill    (#S105) kill -9 of the lead: team closed `lead_ended` (never `orphaned`: no 30-minute window), members gone,
#                   the lead and its descendant processes are dead (children are in-process: nothing to leak).
#   absent  (#S106) the subagents package NOT installed: a session team works end to end; `TeamCreate {mode:"in-process"}` ->
#                   `mode_unavailable` + `subagents_extension_missing` + the install hint; no team; no error / log spam.
#
# FIXTURE: every row runs against the FAKE subagents extension (qa/fixtures/fake-subagents.ext.ts, `pi -e` on the lead only,
# never installed): it implements the RECORDED contract with scripted children, so these rows prove the dashboard side. The
# real-upstream smoke is task 14.1 (after gate 1.11). `absent` loads no fake and no package on purpose.
#
# Hermetic: own prefix (HOME), own port (default 18980), the faux provider staged under the prefix. Inputs are those of
# dist-only-lib.sh (QA_PREFIX, QA_BIN_DIR, QA_DASHBOARD_TARBALL, QA_EXTRA_TARBALLS, QA_PORT, ...) plus
#   QA_INPROC_SECTIONS        space-separated subset of "restart reload kill absent" (default: all four)
#   QA_INPROC_RESTART_RUN_MS  child run length of `restart` (default 15000)
#   QA_INPROC_KILL_WAIT_S     how long `kill` waits for the close (default 240; the heartbeat timeout is 180 s)
#   QA_REPO_ROOT              checkout holding qa/fixtures and the plugin sources (default: this repo)
# SKIPs (`SKIP:` first line + exit 0) without `pi` or a checkout with the fixtures.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${QA_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
FIXTURE_DIR="$REPO_ROOT/qa/fixtures"
FAKE_EXT="$FIXTURE_DIR/fake-subagents.ext.ts"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"
# shellcheck source=agent-teams-inproc-lib.sh
. "$HERE/agent-teams-inproc-lib.sh"

# Hermetic: a developer shell inside a pi session exports PI_DASHBOARD_SOCKET/URL/SESSION_ID..., which would make the faux
# pi sessions below register with THAT dashboard instead of the one under test.
for v in $(compgen -e | grep -E '^(PI_|DASHBOARD_STARTER$)' || true); do unset "$v"; done

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (the in-process persistence smoke needs a real pi lead)"
  exit 0
fi
for f in "$FAKE_EXT" "$FIXTURE_DIR/faux-provider.ext.ts" "$FIXTURE_DIR/faux-scenarios.ts" "$HERE/lib/agent-teams-inproc-persistence.cjs" "$HERE/lib/agent-teams-inproc-drive.cjs"; do
  if [ ! -f "$f" ]; then
    echo "SKIP: $f not found (needs a checkout with qa/fixtures and the packages; set QA_REPO_ROOT)"
    exit 0
  fi
done

SECTIONS="${QA_INPROC_SECTIONS:-restart reload kill absent}"

do_init agent-teams-inproc-persistence 18980
do_banner
echo "sections: $SECTIONS (fixture mode: fake subagents extension $FAKE_EXT)"
do_install
do_config_port
ati_stage_faux "$PREFIX" "$FIXTURE_DIR"
do_boot || do_fail "/api/health never answered 200 on :$PORT"

# The plugin must be loaded in the clean install: a missing route is a regression, not a skip, once the server is up.
PROBE=$(do_cli api GET /api/plugins/agent-teams/teams --port "$PORT" 2>/dev/null || true)
printf '%s' "$PROBE" | grep -q '"teams"' || do_fail "agent-teams plugin routes are not available on :$PORT (plugin not loaded)"

PATH="$BIN_DIR:$PATH" HOME="$PREFIX" \
  QA_BASE="$BASE" QA_PORT_NODE="$PORT" QA_FAKE_EXT="$FAKE_EXT" QA_SCRATCH="$SCRATCH" QA_SERVER_LOG="$LOG" \
  QA_INPROC_SECTIONS="$SECTIONS" \
  node "$HERE/lib/agent-teams-inproc-persistence.cjs" || do_fail "in-process persistence sections failed (see above)"

echo "PASS: agent-teams in-process persistence ($SECTIONS)"
