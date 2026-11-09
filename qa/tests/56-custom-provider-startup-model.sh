#!/usr/bin/env bash
# Test: a custom-provider `--model` resolves at pi STARTUP (X3, X4).
#
# Before this change, `pi --model <custom>/<id>` exited 1 ("Model not found")
# before the bridge ever registered the provider's models. The bridge now
# registers custom-provider models (from a cache or a bounded live discovery)
# inside its awaited factory, so pi resolves the startup `--model`.
#
# Hermetic: own throwaway $HOME + a local /v1/models stub; loads ONLY a tiny
# fixture that calls provider-register's `activate` + `awaitStartupProviderModels`
# (not the full bridge, which would auto-start a server). `SKIP:` + exit 0 when
# pi or node is absent, matching the suite convention (cf. 10-faux-model.sh).
#
# X3: reachable stub → pi does NOT print "not found", does not early-exit 1, and
#     the per-provider cache file is written.
# X4: unreachable uncached provider named by --model → pi exits within 15 s with
#     pi's own "Model ... not found" (bounded by the 5 s startup discovery).
#
# See change: register-custom-provider-models-at-activation (test-plan X3/X4).
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (custom-provider startup-model smoke requires pi installed)"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "SKIP: node not on PATH"
  exit 0
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "=== Test: custom-provider --model resolves at startup ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The qa suite copies only qa/tests to the VM, so the extension source is not
# guaranteed on disk. Resolve it relative to the repo when present; skip cleanly
# otherwise (the L1 vitest layer covers the logic regardless).
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || true)"
EXT_SRC="$REPO_ROOT/packages/extension/src/provider-register.ts"
if [ ! -f "$EXT_SRC" ]; then
  echo "SKIP: extension source not present ($EXT_SRC) — L1 vitest covers the logic"
  exit 0
fi

WORK="$(mktemp -d -t custom-provider-startup-XXXXXX)"
cleanup() {
  [ -n "${STUB_PID:-}" ] && kill -9 "$STUB_PID" 2>/dev/null || true
  [ -n "${PI_PID:-}" ] && kill -9 "$PI_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Minimal fixture: run the real startup path, nothing else.
FIXTURE="$WORK/startup-fixture.ext.ts"
cat > "$FIXTURE" <<EOF
import { activate, awaitStartupProviderModels } from "$EXT_SRC";
export default async function (pi: any): Promise<void> {
  activate(pi);
  await awaitStartupProviderModels();
}
EOF

# /v1/models stub (answers after ~0.8 s so the startup discovery exercises its
# bound). Writes its chosen port to $WORK/port.
cat > "$WORK/stub.mjs" <<'EOF'
import http from "node:http";
import fs from "node:fs";
const srv = http.createServer((req, res) => {
  if (req.url.endsWith("/models")) {
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "faux-1" }] }));
    }, 800);
  } else {
    res.statusCode = 404;
    res.end("{}");
  }
});
srv.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(process.env.PORT_FILE, String(srv.address().port));
});
EOF

run_pi() {
  # $1 = $HOME dir, rest = pi args. Strips dashboard env so the fixture runs
  # inert, and uses the home dir as cwd so no project extension loads.
  local home="$1"; shift
  ( cd "$home" && env -u PI_DASHBOARD_BRIDGE -u PI_DASHBOARD_SOCKET -u PI_DASHBOARD_URL \
      -u PI_DASHBOARD_SPAWNED -u PI_DASHBOARD_REQUIRE_SERVER_PROOF HOME="$home" \
      pi -a -e "$FIXTURE" -p --model "$1" "say hi" </dev/null )
}

# ── X3: reachable custom provider, cold cache ────────────────────────────
echo "--- X3: reachable --model at cold start ---"
PORT_FILE="$WORK/port" node "$WORK/stub.mjs" &
STUB_PID=$!
for _ in $(seq 1 20); do [ -s "$WORK/port" ] && break; sleep 0.2; done
PORT="$(cat "$WORK/port" 2>/dev/null || true)"
[ -n "$PORT" ] || { echo "FAIL: stub did not bind a port"; exit 1; }

H3="$WORK/home-x3"; mkdir -p "$H3/.pi/agent"
printf '{"providers":{"stub":{"baseUrl":"http://127.0.0.1:%s/v1","apiKey":"k","api":"openai-completions"}}}' "$PORT" \
  > "$H3/.pi/agent/providers.json"
CACHE3="$H3/.pi/dashboard/custom-provider-models/stub.json"

run_pi "$H3" "stub/faux-1" > "$WORK/x3.out" 2>&1 &
PI_PID=$!
# The turn itself never completes (the stub is not a full completions server),
# so bound the observation: pass as soon as the cache file appears.
X3_OK=0
for _ in $(seq 1 15); do
  if [ -f "$CACHE3" ]; then X3_OK=1; break; fi
  kill -0 "$PI_PID" 2>/dev/null || break
  sleep 1
done
kill -9 "$PI_PID" 2>/dev/null || true
PI_PID=""

if grep -qiE 'Model .*not found' "$WORK/x3.out"; then
  echo "FAIL: pi printed 'Model not found' for a reachable custom --model"
  cat "$WORK/x3.out"; exit 1
fi
if [ "$X3_OK" -ne 1 ] || [ ! -f "$CACHE3" ]; then
  echo "FAIL: startup cache for 'stub' was not written"
  cat "$WORK/x3.out"; exit 1
fi
grep -q '"keyFingerprint"' "$CACHE3" || { echo "FAIL: cache missing keyFingerprint"; cat "$CACHE3"; exit 1; }
echo "PASS: X3 — reachable custom --model resolved, cache written, no 'not found'"

kill -9 "$STUB_PID" 2>/dev/null || true
STUB_PID=""

# ── X4: unreachable uncached provider named by --model, bounded ──────────
echo "--- X4: unreachable --model is bounded, then 'not found' ---"
H4="$WORK/home-x4"; mkdir -p "$H4/.pi/agent"
# Port 1 is closed → the /v1/models fetch fails fast; no cache entry exists.
printf '{"providers":{"dead":{"baseUrl":"http://127.0.0.1:1/v1","apiKey":"k","api":"openai-completions"}}}' \
  > "$H4/.pi/agent/providers.json"

run_pi "$H4" "dead/x" > "$WORK/x4.out" 2>&1 &
PI_PID=$!
X4_EXITED=0
for _ in $(seq 1 15); do
  if ! kill -0 "$PI_PID" 2>/dev/null; then X4_EXITED=1; break; fi
  sleep 1
done
if [ "$X4_EXITED" -ne 1 ]; then
  echo "FAIL: pi did not exit within 15 s for an unreachable uncached --model (hang)"
  kill -9 "$PI_PID" 2>/dev/null || true
  cat "$WORK/x4.out"; exit 1
fi
wait "$PI_PID" 2>/dev/null || true
PI_PID=""
if ! grep -qiE 'Model "dead/x" not found' "$WORK/x4.out"; then
  echo "FAIL: expected pi's 'Model \"dead/x\" not found' after the bounded discovery"
  cat "$WORK/x4.out"; exit 1
fi
echo "PASS: X4 — unreachable uncached --model bounded, then 'Model not found'"

echo "PASS: custom-provider startup-model smoke"
