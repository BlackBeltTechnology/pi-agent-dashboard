#!/usr/bin/env bash
# Test: plugin lifecycle on a dist-only install — a GLOBAL install through the dashboard appears live
# (test-plan #E101, task 8.140).
# spec: dashboard-plugin-loader › "Plugin lifecycle is verified on a dist-only install" /
#       "Global install appears live on a clean install".
#
# Clean prefix (no monorepo root, no registry): the fixture pi-package plugin is packed into a LOCAL
# directory and installed through `POST /api/packages/install {source:<abs dir>, scope:"global"}` while
# the dashboard runs. Observables:
#   1. the row appears in `GET /api/plugins` with `source:"pi-package"` and NO server restart (same pid)
#   2. its server entry stays unloaded: `loaded:false`, `error:"server-untrusted"`, sentinel absent
#   3. loopback `POST /api/plugins/<id>/trust {server:true}` → the entry loads, pid still unchanged,
#      the sentinel the entry writes on load exists
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

echo "=== Test: global install appears live on a dist-only install (E101) ==="
ID="qa-fixture-plugin"
do_init plugin-global-install 18949
do_banner
do_install
do_pack_fixtures
do_config_port
do_boot || do_fail "/api/health never answered 200 on :$PORT"
PID_BEFORE=$(health_field pid)
[ -n "$PID_BEFORE" ] || do_fail "/api/health has no pid"

if [ -n "$(plugin_row "$ID")" ]; then do_fail "$ID is already listed before the install"; fi

api POST /api/packages/install "{\"source\":\"$FIX_OK\",\"scope\":\"global\"}" >/dev/null
[ "$(api_code)" = "202" ] || do_fail "POST /api/packages/install answered $(api_code) (expected 202): $(cat "$SCRATCH/api.out")"

# 1 + 2: live row, pi-package, server refused.
wait_until 120 "$ID row (source pi-package) after the install" row_has "$ID" 'r.status && r.status.source==="pi-package"'
wait_until 30 "$ID row loaded:false with server-untrusted" row_has "$ID" 'r.status.loaded===false && r.status.error==="server-untrusted"'
[ ! -e "$SENTINEL_OK" ] || do_fail "the untrusted server entry ran (sentinel exists)"
[ "$(health_field pid)" = "$PID_BEFORE" ] || do_fail "the server restarted for a global install (pid changed)"
echo "install: row appeared live, source=pi-package, loaded:false server-untrusted, pid unchanged"

# 3: local server-trust grant loads it without a restart.
api POST "/api/plugins/$ID/trust" '{"server":true}' >/dev/null
[ "$(api_code)" = "200" ] || do_fail "POST /api/plugins/$ID/trust {server:true} answered $(api_code): $(cat "$SCRATCH/api.out")"
wait_until 60 "$ID row loaded:true after the server grant" row_has "$ID" 'r.status.loaded===true'
[ -e "$SENTINEL_OK" ] || do_fail "the plugin reports loaded but its server entry never ran (no sentinel)"
[ "$(health_field pid)" = "$PID_BEFORE" ] || do_fail "the server restarted for a server-trust grant (pid changed)"
echo "grant: loaded:true, pid unchanged, sentinel present"

echo "PASS: global install appears live on a dist-only install (E101)"
