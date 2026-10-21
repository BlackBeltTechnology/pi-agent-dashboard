#!/usr/bin/env bash
# Test: a serveApp grant needs a restart (test-plan #E82, task 8.103).
# spec: plugin-runtime-client-loading › "serveApp grant needs a restart".
#
# A plugin that calls `ctx.serveApp` is mounted (or refused) ONCE, at activation. A trust grant made
# afterwards cannot retro-mount it: the status row says so (`restartRequired:true`) and the mount appears
# only after the next server start.
#
# Fixture: an `installed`-source plugin (`~/.pi/dashboard/plugins/qa-serveapp`, plain JS, no toolchain)
# whose server entry mounts a one-file static app. It is not in the bundled list and has no trust entry,
# so the first boot REFUSES the mount. It carries a tiny `clientBundle` so the operator has a hash to pin
# through the local trust endpoint (any `auth.trustedPlugins` entry trusts the mount, design D12).
#
# Mount probe. An unmounted `/apps/<id>/` is answered by the dashboard's SPA fallback (production build →
# the shell, HTTP 200), so "404" is not a usable signal on a stock install. The probe is therefore the
# fixture's marker string in the body: present ⇔ the mount serves.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

echo "=== Test: serveApp grant needs a restart (E82) ==="
ID="qa-serveapp"
MARKER="qa-serveapp-marker-7f3a"
do_init plugin-serveapp-restart 18948
do_banner
do_install

PLUGIN="$PREFIX/.pi/dashboard/plugins/$ID"
mkdir -p "$PLUGIN/dist/client" "$PLUGIN/app"
cat > "$PLUGIN/package.json" <<JSON
{
  "name": "$ID",
  "version": "1.0.0",
  "type": "module",
  "pi-dashboard-plugin": {
    "id": "$ID",
    "displayName": "QA serveApp fixture",
    "hostApi": "^1.0.0",
    "clientBundle": "./dist/client/index.js",
    "server": "./server.js",
    "claims": [{ "slot": "settings-section", "component": "Settings" }]
  }
}
JSON
echo 'export const Settings = () => null;' > "$PLUGIN/dist/client/index.js"
echo "<!doctype html><title>$MARKER</title><p>$MARKER</p>" > "$PLUGIN/app/index.html"
cat > "$PLUGIN/server.js" <<'JS'
import path from "node:path";
import { fileURLToPath } from "node:url";
export default function register(ctx) {
  ctx.serveApp({
    appId: "qa-serveapp",
    dir: path.join(path.dirname(fileURLToPath(import.meta.url)), "app"),
    csp: "default-src 'self'",
  });
}
JS

mount_serves() { curl -sS "$BASE/apps/$ID/" 2>/dev/null | grep -q "$MARKER"; }

do_config_port
do_boot || do_fail "/api/health never answered 200 on :$PORT"

# Before any grant: mount refused, nothing served.
wait_until 30 "$ID row reports serveApp refused" row_has "$ID" 'r.status && r.status.serveApp==="refused"'
if mount_serves; then do_fail "the refused mount serves its app before any grant"; fi
echo "boot 1: serveApp refused, mount does not serve"

SHA=$(plugin_row "$ID" | jx 'j.status.client && j.status.client.sha256')
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || do_fail "no pinnable sha256 on the $ID row: $(plugin_row "$ID")"

# Local grant → restartRequired, still not mounted.
api POST "/api/plugins/$ID/trust" "{\"sha256\":\"$SHA\"}" >/dev/null
[ "$(api_code)" = "200" ] || do_fail "POST /api/plugins/$ID/trust answered $(api_code)"
wait_until 30 "$ID row restartRequired:true" row_has "$ID" 'r.status.restartRequired===true'
if mount_serves; then do_fail "the mount appeared WITHOUT a restart (a grant must not retro-mount)"; fi
echo "after grant: restartRequired:true, mount still not serving"

# Restart → mounted, serving.
do_restart
do_wait_health() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null || echo 000)" = "200" ]; }
wait_until "$BOOT_TIMEOUT" "/api/health 200 after restart" do_wait_health
wait_until 30 "$ID row reports serveApp mounted" row_has "$ID" 'r.status && r.status.serveApp==="mounted"'
mount_serves || do_fail "the mount does not serve after the restart"
echo "after restart: serveApp mounted, mount serves"

echo "PASS: serveApp grant needs a restart (E82)"
