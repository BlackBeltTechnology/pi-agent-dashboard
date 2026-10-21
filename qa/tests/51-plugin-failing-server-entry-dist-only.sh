#!/usr/bin/env bash
# Test: plugin lifecycle on a dist-only install — a server entry that THROWS on load does not take the
# dashboard down (test-plan #X15, task 8.142).
# spec: dashboard-plugin-loader › "Failing server entry on install".
#
# The throwing fixture is installed through the dashboard (global scope, local pack) and server-trusted, so
# the loader really runs its entry. Observables: the row shows `loaded:false` with an error text that is NOT
# the untrusted refusal; `/api/health` answers 200 before the install and after the grant; same pid.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

echo "=== Test: failing server entry on a dist-only install (X15) ==="
ID="qa-fixture-plugin-throws"
do_init plugin-failing-server-entry 18951
do_banner
do_install
do_pack_fixtures
do_config_port
do_boot || do_fail "/api/health never answered 200 on :$PORT"
PID_BEFORE=$(health_field pid)
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" = "200" ] || do_fail "/api/health is not 200 before the install"

api POST /api/packages/install "{\"source\":\"$FIX_THROWS\",\"scope\":\"global\"}" >/dev/null
[ "$(api_code)" = "202" ] || do_fail "POST /api/packages/install answered $(api_code): $(cat "$SCRATCH/api.out")"
wait_until 120 "$ID row (source pi-package)" row_has "$ID" 'r.status && r.status.source==="pi-package"'

api POST "/api/plugins/$ID/trust" '{"server":true}' >/dev/null
[ "$(api_code)" = "200" ] || do_fail "POST /api/plugins/$ID/trust {server:true} answered $(api_code): $(cat "$SCRATCH/api.out")"

# The loader ran the entry and recorded the failure (not the untrusted refusal).
wait_until 60 "$ID row loaded:false with the load error" row_has "$ID" 'r.status.loaded===false && typeof r.status.error==="string" && r.status.error.length>0 && r.status.error!=="server-untrusted"'
ERR=$(plugin_row "$ID" | jx 'j.status.error')
echo "row: loaded:false, error: $ERR"
case "$ERR" in *"failed on load"*) : ;; *) echo "NOTE: the error text does not quote the thrown message (expected 'failed on load'): $ERR" ;; esac

[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" = "200" ] || do_fail "/api/health is not 200 after the failing entry loaded"
[ "$(health_field pid)" = "$PID_BEFORE" ] || do_fail "the server restarted/crashed on a failing server entry (pid changed)"
echo "health 200 before and after, pid unchanged"

echo "PASS: failing server entry on a dist-only install (X15)"
