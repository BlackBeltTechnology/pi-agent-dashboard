#!/usr/bin/env bash
# Test: plugin lifecycle on a dist-only install — a LOCAL-scope install is only detected, and removing an
# unloaded plugin drops its row (test-plan #E102, task 8.141).
# spec: dashboard-plugin-loader › "Local install is only detected" / "Uninstall of an unloaded plugin".
#
# Needs a REAL active session whose cwd is the project (detection scans the cwds of active sessions), so it
# SKIPs when `pi` is not installed. Observables:
#   1. local-scope `POST /api/packages/install {scope:"local", cwd}` → a `local-detected` row, `loaded:false`,
#      `enabled:false`; the fixture's server entry NEVER runs (sentinel absent, also after a settle period)
#   2. `POST /api/packages/remove` of the same local entry → the row is absent from the next `GET /api/plugins`
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

ID="qa-fixture-plugin"
do_init plugin-local-uninstall 18950
do_install >/dev/null
if ! command -v pi >/dev/null 2>&1 && [ ! -x "$BIN_DIR/pi" ]; then
  echo "SKIP: pi is not installed (local-scope detection needs an active session in the project cwd)"
  exit 0
fi

echo "=== Test: local install only detected; uninstall of an unloaded plugin (E102) ==="
do_banner
do_pack_fixtures
do_config_port
do_boot || do_fail "/api/health never answered 200 on :$PORT"

PROJ="$SCRATCH/project"
mkdir -p "$PROJ"
PROJ=$(cd "$PROJ" && pwd -P)

# An active session in the project cwd.
api POST /api/session/spawn "{\"cwd\":\"$PROJ\"}" >/dev/null
[ "$(api_code)" = "200" ] || do_fail "POST /api/session/spawn answered $(api_code): $(cat "$SCRATCH/api.out")"
session_up() { api GET /api/sessions | jx "(j.data||[]).some(s=>s.cwd===\"$PROJ\")" | grep -q true; }
wait_until 120 "an active session in $PROJ" session_up
SESSION_ID=$(api GET /api/sessions | jx "(j.data||[]).filter(s=>s.cwd===\"$PROJ\").map(s=>s.id)[0]")
# The session writes its transcript under $PREFIX while it exits: let it finish before the prefix is removed.
session_shutdown() { api POST "/api/session/$SESSION_ID/shutdown" >/dev/null 2>&1; sleep 5; }
DO_ON_EXIT=session_shutdown
echo "active session $SESSION_ID in $PROJ"

if [ -n "$(plugin_row "$ID")" ]; then do_fail "$ID is already listed before the install"; fi

# 1: local-scope install → detected, never loaded.
api POST /api/packages/install "{\"source\":\"$FIX_OK\",\"scope\":\"local\",\"cwd\":\"$PROJ\"}" >/dev/null
[ "$(api_code)" = "202" ] || do_fail "local install answered $(api_code) (expected 202): $(cat "$SCRATCH/api.out")"
wait_until 120 "$ID local-detected row" row_has "$ID" 'r.status && r.status.source==="local-detected"'
row_has "$ID" 'r.status.loaded===false && r.status.enabled===false' || do_fail "the local-detected row is loaded or enabled: $(plugin_row "$ID")"
sleep 5
[ ! -e "$SENTINEL_OK" ] || do_fail "a local-scope plugin's server entry ran (sentinel exists)"
echo "local install: local-detected, loaded:false enabled:false, sentinel never created"

# 2: remove → row gone.
api POST /api/packages/remove "{\"source\":\"$FIX_OK\",\"scope\":\"local\",\"cwd\":\"$PROJ\"}" >/dev/null
[ "$(api_code)" = "202" ] || do_fail "local remove answered $(api_code): $(cat "$SCRATCH/api.out")"
row_gone() { [ -z "$(plugin_row "$ID")" ]; }
wait_until 120 "$ID row removed from /api/plugins" row_gone
[ ! -e "$SENTINEL_OK" ] || do_fail "the sentinel appeared during the removal"
echo "remove: row absent from the next GET /api/plugins"

echo "PASS: local install only detected; uninstall of an unloaded plugin (E102)"
