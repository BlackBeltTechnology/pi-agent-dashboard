#!/usr/bin/env bash
# Test: a session replacement keeps the dashboard registration (#1175, test-plan #E31).
#
# Spawns a real `pi --mode rpc` (bridge extension + faux model, no API key), waits for its session to
# register with the live dashboard, then sends the RPC `new_session` command. pi tears the extension
# runtime down (`session_shutdown{reason:"new"}`) and loads a FRESH ExtensionAPI for the replacement.
# Before the fix the bridge re-entry guard mistook that instance for a subagent and skipped init, so
# the NEW session id never registered. Asserts via GET /api/sessions that a NEW id is registered and
# the old id is gone (absent or ended) within a timeout.
# See change: fix-session-bridge-registration.
set -euo pipefail

# Skip cleanly (SKIP: first line + exit 0) when pi is not on PATH (cf. 10-faux-model.sh).
if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (session-replacement smoke requires pi installed)"
  exit 0
fi

echo "=== Test: bridge re-registers after RPC new_session ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURE="$REPO_ROOT/qa/fixtures/faux-provider.ext.ts"

if [ ! -f "$FIXTURE" ]; then
  echo "FAIL: fixture not found at $FIXTURE"
  exit 1
fi

# Ensure the dashboard server is up (started by an earlier test, else start it).
STARTED_SERVER=0
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  pi-dashboard start &
  STARTED_SERVER=1
  ELAPSED=0
  while [ $ELAPSED -lt 15 ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
    [ "$HTTP_CODE" = "200" ] && break
    sleep 1; ELAPSED=$((ELAPSED + 1))
  done
fi
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: dashboard server not reachable (health=$HTTP_CODE)"
  exit 1
fi

cleanup() {
  [ "$STARTED_SERVER" = "1" ] && pi-dashboard stop 2>/dev/null || true
}
trap cleanup EXIT

# Node owns the drive + polling. A unique cwd identifies this run's sessions in /api/sessions.
cd "$REPO_ROOT"
FIXTURE="$FIXTURE" node -e '
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FIXTURE = process.env.FIXTURE;
const TIMEOUT_MS = 45000;
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-replace-")));
let child;

const done = (code, msg) => {
  console.log(msg);
  if (child) { try { child.kill("SIGKILL"); } catch {} }
  process.exit(code);
};
const fail = (m) => done(1, "FAIL: " + m);

// `pi-dashboard api` mints local proof (the strict `requireLocalProof` default refuses a bare request).
const mine = () => {
  const out = execFileSync("pi-dashboard", ["api", "GET", "/api/sessions"], { encoding: "utf8" });
  return (JSON.parse(out).data || []).filter((s) => s.cwd === home);
};
const live = (s) => s.status !== "ended";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, what) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    let v;
    try { v = pred(mine()); } catch (e) { fail("/api/sessions query failed: " + e.message); }
    if (v) return v;
    await sleep(500);
  }
  fail("timed out waiting for " + what + " (sessions in cwd: " + JSON.stringify(mine().map((s) => [s.id, s.status])) + ")");
}

(async () => {
  child = spawn("pi", ["--mode", "rpc", "-e", FIXTURE, "--model", "faux/faux-1"], {
    cwd: home,
    env: { ...process.env, HOME: home, FAUX_SCRIPT: "plain-text" },
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.on("error", (e) => fail("pi spawn error: " + e.message));

  const oldId = (await waitFor((ss) => ss.find(live), "the first session to register")).id;
  console.log("first session registered: " + oldId);

  // RPC new_session: pi emits session_shutdown{reason:"new"}, then loads a fresh ExtensionAPI.
  child.stdin.write(JSON.stringify({ type: "new_session" }) + "\n");

  const next = await waitFor((ss) => ss.find((s) => s.id !== oldId && live(s)), "a NEW session id to register");
  console.log("replacement session registered: " + next.id);
  await waitFor((ss) => !ss.some((s) => s.id === oldId && live(s)), "the old session to unregister");
  done(0, "OK: new session registered, old session unregistered");
})();
'

echo "PASS: bridge re-registers after RPC new_session"
