#!/usr/bin/env bash
# Test: a runtime-delivered plugin works on a DIST-ONLY install — API half (test-plan #E100, task 8.138).
# spec: plugin-runtime-client-loading › "Runtime delivery is verified on a dist-only install".
#
# Why a VM and not the docker harness: the harness image has a full workspace at /app, so a monorepo root
# always resolves there and a bug that only exists WITHOUT one (the npm-global layout) is invisible.
# This script installs the dashboard into a clean prefix (no monorepo root, no toolchain), drops the
# PREBUILT canary into `~/.pi/dashboard/plugins`, and drives the trust grant over loopback.
#
# Observables (each is an assertion below):
#   1. before the grant: the canary row is refused `untrusted` and carries the current sha256
#   2. loopback `POST /api/plugins/<id>/trust {sha256}` → 200
#   3. `/api/plugins` row `client.delivery:"runtime"`
#   4. `/api/plugins/runtime-clients` lists the canary
#   5. its entry URL answers 200 with an immutable Cache-Control
#   6. no file under any installed `dist/` changed (nothing was rebuilt)
#   7. `/api/health.bundleHash` is the same before and after (a runtime plugin never changes the build hash)
#
# Needs QA_CANARY_DIR (a staged canary plugin dir); SKIPs without it. The render half is the dist-only
# Playwright project (task 8.139), which this script does not replace.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

if [ -z "${QA_CANARY_DIR:-}" ] || [ ! -f "${QA_CANARY_DIR}/package.json" ]; then
  echo "SKIP: QA_CANARY_DIR not set to a staged runtime canary (node scripts/stage-runtime-canary.mjs --out <d> --mode untrusted → <d>/plugins/runtime-canary)"
  exit 0
fi

echo "=== Test: runtime delivery on a dist-only install (E100) ==="
ID="runtime-canary"
do_init plugin-runtime-dist-only 18947
do_banner
do_install
do_stage_canary || do_fail "could not stage the canary from $QA_CANARY_DIR"
do_config_port
do_boot || do_fail "/api/health never answered 200 on :$PORT"

DIGEST_BEFORE=$(dist_digest) || do_fail "could not digest the installed dist/ trees"
HASH_BEFORE=$(health_field bundleHash)
[ -n "$HASH_BEFORE" ] || do_fail "/api/health has no bundleHash"
PID_BEFORE=$(health_field pid)

# 1. refused untrusted, with the hash the operator would pin.
wait_until 30 "canary row refused untrusted with a sha256" row_has "$ID" 'r.status && r.status.client && r.status.client.delivery==="refused" && r.status.client.refusedReason==="untrusted" && /^[0-9a-f]{64}$/.test(r.status.client.sha256||"")'
SHA=$(plugin_row "$ID" | jx 'j.status.client.sha256')
echo "canary refused untrusted, sha256 ${SHA:0:12}…"

# 2. local grant.
api POST "/api/plugins/$ID/trust" "{\"sha256\":\"$SHA\"}" >/dev/null
[ "$(api_code)" = "200" ] || do_fail "POST /api/plugins/$ID/trust answered $(api_code) (expected 200 from loopback)"

# 3. delivery runtime.
wait_until 30 "canary row client.delivery runtime" row_has "$ID" 'r.status.client.delivery==="runtime"'
echo "row: client.delivery=runtime"

# 4. listing + 5. entry URL.
LISTING=$(api GET /api/plugins/runtime-clients)
[ "$(api_code)" = "200" ] || do_fail "GET /api/plugins/runtime-clients answered $(api_code)"
ENTRY=$(printf '%s' "$LISTING" | jx "(j.plugins||[]).filter(p=>p.id===\"$ID\").map(p=>p.entry)[0]")
[ -n "$ENTRY" ] || do_fail "runtime-clients listing does not contain $ID: $LISTING"
case "$ENTRY" in "/plugin-assets/$ID/$SHA/"*) : ;; *) do_fail "entry URL is not under /plugin-assets/$ID/$SHA/: $ENTRY" ;; esac
HEADERS=$(curl -sS -D - -o /dev/null "$BASE$ENTRY")
printf '%s' "$HEADERS" | head -1 | grep -q ' 200' || do_fail "entry URL did not answer 200: $(printf '%s' "$HEADERS" | head -1)"
printf '%s' "$HEADERS" | grep -qi '^cache-control:.*immutable' || do_fail "entry URL lacks an immutable Cache-Control: $HEADERS"
echo "listing contains $ID; entry $ENTRY → 200 immutable"

# 6. nothing rebuilt.
DIGEST_AFTER=$(dist_digest)
[ "$DIGEST_BEFORE" = "$DIGEST_AFTER" ] || do_fail "an installed dist/ file changed during the grant ($DIGEST_BEFORE → $DIGEST_AFTER)"
echo "dist/ trees unchanged (${DIGEST_BEFORE%%:*} files)"

# 7. build hash + process unchanged.
[ "$(health_field bundleHash)" = "$HASH_BEFORE" ] || do_fail "/api/health.bundleHash changed after a runtime grant"
[ "$(health_field pid)" = "$PID_BEFORE" ] || do_fail "the server restarted during a runtime grant (pid changed)"
echo "bundleHash and pid unchanged"

echo "PASS: runtime delivery on a dist-only install (E100)"
