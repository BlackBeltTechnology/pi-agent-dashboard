#!/usr/bin/env bash
# Test: pi-dashboard server starts and health endpoint responds
set -euo pipefail

echo "=== Test: Server start ==="

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Start the server in background
pi-dashboard start &
SERVER_PID=$!

# Cleanup on exit
cleanup() {
  pi-dashboard stop 2>/dev/null || true
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for health endpoint (up to 15 seconds)
ELAPSED=0
TIMEOUT=15
while [ $ELAPSED -lt $TIMEOUT ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health endpoint responded HTTP 200"

    # See change: expand-electron-qa-coverage.
    # Catches v0.4.6 spawnDetached stdio[1]='ignore' regression where
    # successful spawns produced 0-byte log files. Server log lives at
    # ~/.pi/dashboard/server.log (written by cli.ts daemonize path).
    LOG_PATH="$HOME/.pi/dashboard/server.log"
    if [ ! -f "$LOG_PATH" ]; then
      echo "FAIL: $LOG_PATH does not exist after successful spawn"
      exit 1
    fi
    if [ ! -s "$LOG_PATH" ]; then
      echo "FAIL: $LOG_PATH is 0 bytes after successful spawn (stdio regression?)"
      exit 1
    fi
    echo "Server log non-empty ($LOG_PATH, $(wc -c < "$LOG_PATH") bytes)"

    # See change: update-pi-core-0-84-adopt-apis (test-plan #X10, #X11).
    # The pi 0.84.1 bump touches provider-register.ts (model-registry refresh)
    # and the auto-session-namer (null-bearing provider headers). Both are
    # exercised through MOCKED catalog probes at L1, so a pi-ai symbol break
    # would pass every unit test and only surface on a real boot. Assert the
    # real server log carries no such runtime failure.
    if grep -qiE "is not a function|is not defined|Cannot find module|SyntaxError" "$LOG_PATH"; then
      echo "FAIL: server.log carries an unresolved-symbol/module error after the pi bump:"
      grep -inE "is not a function|is not defined|Cannot find module|SyntaxError" "$LOG_PATH" | head -5
      exit 1
    fi
    echo "No unresolved-symbol errors in server.log"

    # The running pi must satisfy the declared compatibility floor, and the
    # health probe must not report a blocking skew error.
    #
    # `curl -fsS` (not `-s`): a transport failure or non-2xx must FAIL the test
    # rather than feed an empty body to the parser, which would print nothing
    # and be misread as "no compatibility error".
    if ! HEALTH_JSON=$(curl -fsS http://localhost:8000/api/health 2>/dev/null); then
      echo "FAIL: could not fetch /api/health for the compatibility check"
      exit 1
    fi
    # The parser exits non-zero on unparseable JSON, so a malformed body fails
    # loudly instead of silently reporting success.
    if ! COMPAT_ERROR=$(printf '%s' "$HEALTH_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}const c=j.compatibility;process.stdout.write(c&&c.error?c.error:'')})"); then
      echo "FAIL: /api/health returned a body that is not valid JSON"
      exit 1
    fi
    if [ -n "$COMPAT_ERROR" ]; then
      echo "FAIL: /api/health reports a blocking pi compatibility error: $COMPAT_ERROR"
      exit 1
    fi
    echo "No blocking pi compatibility error"

    # --- Retention + heap-headroom health fields (test-plan #T8) -----------
    # See change: bound-event-store-by-bytes (D4).
    #
    # Process-level smoke: the aggregate byte budget is only observable
    # through /api/health, so assert on a REAL boot that the retention gauge,
    # the effective budgets and the V8 heap ceiling are all present and
    # non-null. Unit tests cover their values; only a boot proves the wiring.
    RETENTION_VERDICT=$(printf '%s' "$HEALTH_JSON" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        let j;try{j=JSON.parse(s)}catch{console.log("FAIL: /api/health body is not JSON");return;}
        const r=j.storeRetention;
        if(!r||typeof r!=="object"){console.log("FAIL: storeRetention missing from /api/health");return;}
        if(typeof r.residentBytes!=="number"){console.log("FAIL: storeRetention.residentBytes is not a number ("+r.residentBytes+")");return;}
        const e=r.effective;
        if(!e||typeof e!=="object"){console.log("FAIL: storeRetention.effective missing");return;}
        for(const k of ["maxBytesPerSession","maxTotalEventBytes","maxCachedSessions"]){
          if(typeof e[k]!=="number"){console.log("FAIL: storeRetention.effective."+k+" is not a number ("+e[k]+")");return;}
        }
        if(typeof r.globalBudgetExceeded!=="boolean"){console.log("FAIL: storeRetention.globalBudgetExceeded is not a boolean");return;}
        const hsl=j.server&&j.server.heapSizeLimit;
        if(typeof hsl!=="number"||!(hsl>0)){console.log("FAIL: server.heapSizeLimit is not a positive number ("+hsl+")");return;}
        console.log("OK: storeRetention residentBytes="+r.residentBytes+", effective="+JSON.stringify(e)+", heapSizeLimit="+hsl);
      });
    ')
    case "$RETENTION_VERDICT" in
      OK*) echo "$RETENTION_VERDICT" ;;
      *) echo "$RETENTION_VERDICT"; exit 1 ;;
    esac

    # --- Resolved spawn-runtime publication (test-plan #X7) ---------------
    # See change: unify-pi-runtime-identity (task 9.25).
    #
    # After a fresh start the server publishes the diagnostic
    # `runtime.resolved` block into ~/.pi/dashboard/config.json. On this
    # single-Node machine the resolved runtime IS the `node` on PATH (the
    # same node running this check), so its abi must equal
    # process.versions.modules and source must be a non-null classification.
    # `runtime.override` is user-owned and never written by the dashboard;
    # this script does not set one, so the key must be absent or an intact
    # string (a pre-existing machine pin preserved by the write).
    RUNTIME_VERDICT=$(node -e '
      const fs = require("fs");
      const file = process.env.HOME + "/.pi/dashboard/config.json";
      let j;
      try {
        j = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) {
        console.log("FAIL: " + file + " is not parseable JSON — publication may have truncated it (" + e.message + ")");
        process.exit(0);
      }
      const r = j.runtime && j.runtime.resolved;
      if (!r || typeof r !== "object") {
        console.log("FAIL: runtime.resolved missing from " + file + " after a successful start");
        process.exit(0);
      }
      if (!r.source) {
        console.log("FAIL: runtime.resolved.source is empty — expected a non-null classification");
        process.exit(0);
      }
      const runningAbi = process.versions.modules;
      if (String(r.abi) !== String(runningAbi)) {
        console.log("FAIL: runtime.resolved.abi=" + r.abi + " does not match the running node ABI " + runningAbi);
        process.exit(0);
      }
      const o = j.runtime.override;
      if (o !== undefined && o !== null && typeof o !== "string") {
        console.log("FAIL: runtime.override must be absent or a string; found " + typeof o);
        process.exit(0);
      }
      console.log("OK: runtime.resolved published (source=" + r.source + ", abi=" + r.abi + ", " + (o === undefined || o === null ? "no override set" : "override preserved") + ")");
    ')
    case "$RUNTIME_VERDICT" in
      OK*) echo "$RUNTIME_VERDICT" ;;
      *) echo "$RUNTIME_VERDICT"; exit 1 ;;
    esac

    # GET /api/doctor must answer with a parseable report carrying zero
    # ABI-mismatch rows. The dedicated runtime Doctor rows land with task
    # 5.4 of unify-pi-runtime-identity; the scan below is forward-safe —
    # it asserts on whatever rows exist the day it runs.
    if ! DOCTOR_JSON=$(curl -fsS http://localhost:8000/api/doctor 2>/dev/null); then
      echo "FAIL: GET /api/doctor did not return 2xx"
      exit 1
    fi
    DOCTOR_VERDICT=$(printf '%s' "$DOCTOR_JSON" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let j;
        try { j = JSON.parse(s); } catch (e) { console.log("FAIL: /api/doctor body is not JSON"); return; }
        const checks = Array.isArray(j.checks) ? j.checks : null;
        if (!checks) { console.log("FAIL: /api/doctor report has no checks array"); return; }
        const abiBad = checks.filter(
          (c) => /abi/i.test((c.name || "") + " " + (c.code || "")) && c.status === "error",
        );
        if (abiBad.length > 0) {
          console.log("FAIL: /api/doctor carries ABI-mismatch rows: " + abiBad.map((c) => c.name).join("; "));
          return;
        }
        console.log("OK: /api/doctor parseable, " + checks.length + " checks, no ABI-mismatch rows");
      });
    ')
    case "$DOCTOR_VERDICT" in
      OK*) echo "$DOCTOR_VERDICT" ;;
      *) echo "$DOCTOR_VERDICT"; exit 1 ;;
    esac

    # --- MCP endpoint conformance, at process level -----------------------
    # See change: add-dashboard-mcp-server.
    #
    # E3: GET /mcp MUST answer 405. This is asserted here, against a REAL
    # server, because the failure mode is invisible to a unit test: Fastify
    # falls an unmatched method through to setNotFoundHandler, which serves the
    # SPA. A conformance failure therefore looks like HTTP 200 + HTML, i.e.
    # like success. Sent with no Accept header, the shape most likely to be
    # answered with a web page.
    MCP_CODE=$(curl -s -o /tmp/mcp-get-body -w "%{http_code}" -X GET http://localhost:8000/mcp 2>/dev/null || echo "000")
    if [ "$MCP_CODE" != "405" ]; then
      echo "FAIL: GET /mcp returned $MCP_CODE, expected 405"
      exit 1
    fi
    if grep -qi "<!doctype html\|<html" /tmp/mcp-get-body 2>/dev/null; then
      echo "FAIL: GET /mcp returned the SPA document instead of a 405 payload"
      exit 1
    fi
    echo "GET /mcp returned 405 and did not fall through to the SPA"

    MCP_DELETE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8000/mcp 2>/dev/null || echo "000")
    if [ "$MCP_DELETE_CODE" != "405" ]; then
      echo "FAIL: DELETE /mcp returned $MCP_DELETE_CODE, expected 405"
      exit 1
    fi
    echo "DELETE /mcp returned 405"

    # An unauthenticated POST must be refused. Proves the endpoint self-guards
    # rather than inheriting the loopback allowance every other route has --
    # this request originates from localhost.
    MCP_POST_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/mcp \
      -H "content-type: application/json" -H "mcp-protocol-version: 2026-07-28" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null || echo "000")
    if [ "$MCP_POST_CODE" != "401" ]; then
      echo "FAIL: unauthenticated POST /mcp from localhost returned $MCP_POST_CODE, expected 401"
      exit 1
    fi
    echo "Unauthenticated POST /mcp refused from loopback (401)"

    # E28: no OAuth callback port is bound. This change implements no OAuth
    # flow precisely so it cannot contend with pi-mcp-adapter's own callback
    # server. Asserted by enumerating the server process's listening ports and
    # requiring only the two it should own.
    if command -v lsof >/dev/null 2>&1; then
      LISTENING=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$SERVER_PID" 2>/dev/null | awk 'NR>1 {print $9}' | sed 's/.*://' | sort -u | tr '\n' ' ')
      echo "Server listening ports: ${LISTENING:-none}"
      for PORT in $LISTENING; do
        case "$PORT" in
          8000|8001) ;;
          *)
            echo "FAIL: unexpected listening port $PORT — an OAuth callback listener would contend with pi-mcp-adapter"
            exit 1
            ;;
        esac
      done
      echo "No OAuth callback port bound"
    else
      echo "SKIP: lsof unavailable, cannot enumerate listening ports (E28)"
    fi

    # --- Bind-vs-trust reachability startup log (test-plan #S1-#S3) -------
    # See change: warn-unreachable-trusted-networks.
    #
    # Asserted at PROCESS level because the whole point of the log line is the
    # operator who never opens Settings. A unit test on the formatter proves the
    # string; only a real boot proves the line is actually emitted, exactly
    # once, with the resolved bind host the process really bound.
    CONFIG_PATH="$HOME/.pi/dashboard/config.json"
    CONFIG_BACKUP=""
    if [ -f "$CONFIG_PATH" ]; then
      CONFIG_BACKUP=$(cat "$CONFIG_PATH")
    fi

    restore_config() {
      pi-dashboard stop >/dev/null 2>&1 || true
      if [ -n "$CONFIG_BACKUP" ]; then
        printf '%s' "$CONFIG_BACKUP" > "$CONFIG_PATH"
      else
        rm -f "$CONFIG_PATH"
      fi
    }
    trap 'restore_config; cleanup' EXIT

    # Boot with the given config.json and leave the fresh log in $LOG_PATH.
    boot_with_config() {
      pi-dashboard stop >/dev/null 2>&1 || true
      sleep 2
      mkdir -p "$(dirname "$CONFIG_PATH")"
      printf '%s' "$1" > "$CONFIG_PATH"
      : > "$LOG_PATH"
      pi-dashboard start >/dev/null 2>&1 &
      # 15s, matching the bound the main health probe above enforces.
      local waited=0
      while [ $waited -lt 15 ]; do
        if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then return 0; fi
        sleep 1
        waited=$((waited + 1))
      done
      return 1
    }

    TRUSTED_LOOPBACK='{"port":8000,"bindHost":"127.0.0.1","auth":{"bypassHosts":["192.168.1.0/24"]}}'
    TRUSTED_ALL='{"port":8000,"bindHost":"0.0.0.0","auth":{"bypassHosts":["192.168.1.0/24"]}}'
    TRUSTED_NO_BINDHOST='{"port":8000,"auth":{"bypassHosts":["192.168.1.0/24"]}}'

    # S1 — a loopback bind with a LAN trusted entry warns exactly once, naming
    # both the bind host and the unreachable entry.
    if ! boot_with_config "$TRUSTED_LOOPBACK"; then
      echo "FAIL: server did not come up for the #S1 bind-reachability check"
      exit 1
    fi
    WARN_COUNT=$(grep -c "\[bind-reachability\]" "$LOG_PATH" || true)
    if [ "$WARN_COUNT" != "1" ]; then
      echo "FAIL (#S1): expected exactly 1 [bind-reachability] line, got $WARN_COUNT"
      grep -n "bind-reachability" "$LOG_PATH" | head -5
      exit 1
    fi
    if ! grep "\[bind-reachability\]" "$LOG_PATH" | grep -q "127.0.0.1"; then
      echo "FAIL (#S1): the warning does not name the resolved bind host 127.0.0.1"
      exit 1
    fi
    if ! grep "\[bind-reachability\]" "$LOG_PATH" | grep -q "192.168.1.0/24"; then
      echo "FAIL (#S1): the warning does not name the unreachable entry 192.168.1.0/24"
      exit 1
    fi
    echo "#S1: one [bind-reachability] warning naming 127.0.0.1 and 192.168.1.0/24"

    # S2 — the same entries under an all-interfaces bind are reachable, so the
    # line must be ABSENT. Pins the advisory against firing on a correct config.
    if ! boot_with_config "$TRUSTED_ALL"; then
      echo "FAIL: server did not come up for the #S2 bind-reachability check"
      exit 1
    fi
    if grep -q "\[bind-reachability\]" "$LOG_PATH"; then
      echo "FAIL (#S2): a [bind-reachability] line was emitted for a 0.0.0.0 bind"
      grep -n "bind-reachability" "$LOG_PATH" | head -5
      exit 1
    fi
    echo "#S2: no [bind-reachability] line for a 0.0.0.0 bind"

    # S3 — the container shape: PI_DASHBOARD_HOST supplies the bind host and
    # config.json carries NO bindHost key, so `config.bindHost` reads as the
    # 127.0.0.1 default while the server really binds 0.0.0.0. Scoring the
    # config value instead of the RESOLVED one would fire the advisory in every
    # container that has a trusted network (design Decision 10).
    export PI_DASHBOARD_HOST=0.0.0.0
    if ! boot_with_config "$TRUSTED_NO_BINDHOST"; then
      echo "FAIL: server did not come up for the #S3 bind-reachability check"
      unset PI_DASHBOARD_HOST
      exit 1
    fi
    if grep -q "\[bind-reachability\]" "$LOG_PATH"; then
      echo "FAIL (#S3): a [bind-reachability] line was emitted with PI_DASHBOARD_HOST=0.0.0.0"
      grep -n "bind-reachability" "$LOG_PATH" | head -5
      unset PI_DASHBOARD_HOST
      exit 1
    fi
    UNREACHABLE=$(curl -fsS http://localhost:8000/api/config 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}const r=j.data&&j.data.reachability;process.stdout.write(r?JSON.stringify(r.unreachable):'MISSING')})")
    unset PI_DASHBOARD_HOST
    if [ "$UNREACHABLE" != "[]" ]; then
      echo "FAIL (#S3): reachability.unreachable was '$UNREACHABLE', expected []"
      exit 1
    fi
    echo "#S3: no warning and reachability.unreachable empty under PI_DASHBOARD_HOST=0.0.0.0"

    # =========================================================================
    # Server heap ceiling from config (change: bound-session-heap-and-gc-telemetry)
    # test-plan #E22, #X1, #X2, #X11
    #
    # These can only be proven against a REAL boot: the wrapper reads the config
    # with plain `JSON.parse` before jiti exists, so no unit test covers the
    # path that actually sizes the process.
    # =========================================================================
    echo "--- Checking serverHeap ceiling from config (E22, X1, X2, X11) ---"

    # `heap_size_limit` is the REQUEST plus V8's fixed overhead (~192 MB on the
    # measurement host) — never an exact match. The band is [request, request+300].
    heap_limit_mb() {
      curl -fsS http://localhost:8000/api/health 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(String(Math.round((j.server&&j.server.heapSizeLimit||0)/1048576)))})"
    }
    effective_mb() {
      curl -fsS http://localhost:8000/api/health 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(String(j.server&&j.server.effectiveMaxOldSpaceMb))})"
    }

    # E22 — a configured ceiling reaches the process.
    if ! boot_with_config '{"port":8000,"serverHeap":{"maxOldSpaceMb":4096}}'; then
      echo "FAIL: server did not come up for the #E22 serverHeap check"
      exit 1
    fi
    HEAP_MB=$(heap_limit_mb)
    if [ "$HEAP_MB" -lt 4096 ] || [ "$HEAP_MB" -gt 4396 ]; then
      echo "FAIL (#E22): heap_size_limit ${HEAP_MB} MB outside [4096, 4396] for a 4096 request"
      exit 1
    fi
    if [ "$(effective_mb)" != "4096" ]; then
      echo "FAIL (#E22): reported effective ceiling was '$(effective_mb)', expected 4096"
      exit 1
    fi
    echo "#E22: serverHeap 4096 yields heap_size_limit ${HEAP_MB} MB and effective 4096"

    # X1 — a malformed config must not stop the server booting; it takes 1536.
    if ! boot_with_config '{"port":8000,"serverHeap":{'; then
      echo "FAIL (#X1): server did not start with a malformed config.json"
      exit 1
    fi
    HEAP_MB=$(heap_limit_mb)
    if [ "$HEAP_MB" -lt 1536 ] || [ "$HEAP_MB" -gt 1836 ]; then
      echo "FAIL (#X1): malformed config gave ${HEAP_MB} MB, expected the 1536 default band"
      exit 1
    fi
    echo "#X1: malformed config boots at the 1536 default (${HEAP_MB} MB)"

    # X2 — no config file at all behaves the same way.
    pi-dashboard stop >/dev/null 2>&1 || true
    sleep 2
    rm -f "$CONFIG_PATH"
    : > "$LOG_PATH"
    pi-dashboard start >/dev/null 2>&1 &
    waited=0
    while [ $waited -lt 15 ]; do
      curl -fsS http://localhost:8000/api/health >/dev/null 2>&1 && break
      sleep 1
      waited=$((waited + 1))
    done
    HEAP_MB=$(heap_limit_mb)
    if [ "$HEAP_MB" -lt 1536 ] || [ "$HEAP_MB" -gt 1836 ]; then
      echo "FAIL (#X2): absent config gave ${HEAP_MB} MB, expected the 1536 default band"
      exit 1
    fi
    echo "#X2: absent config boots at the 1536 default (${HEAP_MB} MB)"

    # X11 — an in-place restart inherits the environment, so it keeps the
    # ceiling it is already running under. This is the property the settings
    # copy promises; if the restart DID adopt the new value the copy would be
    # wrong, so the assertion is on the restart keeping the old one.
    if ! boot_with_config '{"port":8000,"serverHeap":{"maxOldSpaceMb":2048}}'; then
      echo "FAIL: server did not come up for the #X11 cold-start check"
      exit 1
    fi
    identity() {
      curl -fsS http://localhost:8000/api/health 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(j.pid+'@'+j.startedAt)})"
    }
    BEFORE=$(effective_mb)
    BEFORE_ID=$(identity)
    printf '%s' '{"port":8000,"serverHeap":{"maxOldSpaceMb":3072}}' > "$CONFIG_PATH"
    # The handler spawns the replacement and then exits, so curl's own status is
    # meaningless here — a closed connection is the SUCCESS path.
    curl -fsS -X POST http://localhost:8000/api/restart >/dev/null 2>&1 || true
    sleep 6
    waited=0
    while [ $waited -lt 20 ]; do
      curl -fsS http://localhost:8000/api/health >/dev/null 2>&1 && break
      sleep 1
      waited=$((waited + 1))
    done
    AFTER_ID=$(identity)
    # Without this, "the POST never arrived" is indistinguishable from "the
    # replacement kept the ceiling" — both leave the number unchanged.
    if [ "$AFTER_ID" = "$BEFORE_ID" ]; then
      echo "FAIL (#X11): no replacement process observed ($BEFORE_ID unchanged) — the restart did not happen"
      exit 1
    fi
    AFTER=$(effective_mb)
    if [ "$AFTER" != "$BEFORE" ]; then
      echo "FAIL (#X11): in-place restart changed the ceiling from $BEFORE to $AFTER"
      exit 1
    fi
    if ! boot_with_config '{"port":8000,"serverHeap":{"maxOldSpaceMb":3072}}'; then
      echo "FAIL (#X11): server did not come up for the cold-start half"
      exit 1
    fi
    if [ "$(effective_mb)" != "3072" ]; then
      echo "FAIL (#X11): a cold start reported '$(effective_mb)', expected 3072"
      exit 1
    fi
    echo "#X11: in-place restart keeps $BEFORE; a cold start adopts 3072"

    restore_config

    # =========================================================================
    # Docker packaging: Kroki overlay configuration assertion (test-plan #D1, #D2)
    # =========================================================================
    echo "--- Checking docker compose configurations (D1, D2) ---"
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

    # D1: Default compose has no kroki service and no KROKI_URL
    DEFAULT_CONFIG=$(docker compose -f "$REPO_ROOT/docker/compose.yml" config 2>/dev/null || true)
    if [ -n "$DEFAULT_CONFIG" ]; then
      if echo "$DEFAULT_CONFIG" | grep -qi "kroki:"; then
        echo "FAIL (#D1): default compose.yml contains kroki service"
        exit 1
      fi
      if echo "$DEFAULT_CONFIG" | grep -qi "KROKI_URL"; then
        echo "FAIL (#D1): default compose.yml sets KROKI_URL"
        exit 1
      fi
      echo "#D1: default compose.yml has no kroki service and no KROKI_URL"
    else
      echo "WARN: docker compose config failed or docker unavailable; skipping D1 config assertion"
    fi

    # D2: Overlay wires both kroki service (with safe mode and no ports) and KROKI_URL on pi-dashboard
    OVERLAY_CONFIG=$(docker compose -f "$REPO_ROOT/docker/compose.yml" -f "$REPO_ROOT/docker/compose.kroki.yml" config 2>/dev/null || true)
    if [ -n "$OVERLAY_CONFIG" ]; then
      if ! echo "$OVERLAY_CONFIG" | grep -qi "kroki:"; then
        echo "FAIL (#D2): overlay does not define kroki service"
        exit 1
      fi
      if ! echo "$OVERLAY_CONFIG" | grep -qi "KROKI_SAFE_MODE: \"*secure\"*"; then
        echo "FAIL (#D2): kroki service missing KROKI_SAFE_MODE=secure"
        exit 1
      fi
      if ! echo "$OVERLAY_CONFIG" | grep -qi "KROKI_URL: \"*http://kroki:8000\"*"; then
        echo "FAIL (#D2): pi-dashboard missing KROKI_URL=http://kroki:8000"
        exit 1
      fi
      echo "#D2: overlay wires kroki service with safe mode and KROKI_URL on pi-dashboard"
    else
      echo "WARN: docker compose overlay config failed or docker unavailable; skipping D2 config assertion"
    fi

    echo "PASS: Server started successfully"
    exit 0
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "FAIL: Health endpoint did not respond HTTP 200 within ${TIMEOUT}s (got: $HTTP_CODE)"
exit 1
