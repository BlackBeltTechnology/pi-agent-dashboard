#!/usr/bin/env bash
# Test: faux-model prompt round-trip on a clean VM.
#
# Spawns a real `pi` session driven by the faux fixture (no API key, no real
# model), drives one happy-path prompt through the dashboard REST API, and
# asserts the scripted assistant text reaches the browser WebSocket. This is the
# single VM-level faux smoke; the full scenario matrix lives in the Vitest layers
# (packages/server + packages/client). See change: add-faux-model-integration-tests.
set -euo pipefail

# Skip cleanly (SKIP: first line + exit 0) when pi is not on PATH, matching the
# existing convention (cf. 08-electron-real-launch.sh). A bare box without pi
# must not red-fail run-all.sh.
if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (faux-model smoke requires pi installed)"
  exit 0
fi

echo "=== Test: faux-model prompt round-trip ==="

# Source nvm
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

# Node owns the round-trip: connect /ws, snapshot pre-existing sessions, spawn a
# faux-backed pi (the globally-installed bridge auto-registers it), drive the
# prompt via REST, and assert the scripted text streams back. Run from the repo
# so `require("ws")` resolves against the repo's node_modules.
cd "$REPO_ROOT"
FIXTURE="$FIXTURE" node -e '
const WebSocket = require("ws");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FIXTURE = process.env.FIXTURE;
const MARKER = "The quick brown faux jumps over the lazy dog.";
const messages = [];
const preExisting = new Set();
let sessionId;
let child;

const done = (code, msg) => {
  if (msg) console.log(msg);
  if (child) { try { child.kill("SIGKILL"); } catch {} }
  process.exit(code);
};
const fail = (m) => done(1, "FAIL: " + m);

const ws = new WebSocket("ws://localhost:8000/ws");
ws.on("error", (e) => fail("ws error: " + e.message));

ws.on("open", () => {
  // Drain the connect-time snapshot of pre-existing sessions, then spawn pi.
  setTimeout(() => {
    for (const m of messages) {
      if (m.type === "session_added" && m.session && m.session.id) preExisting.add(m.session.id);
    }
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "faux-smoke-"));
    child = spawn("pi", ["--mode", "rpc", "-e", FIXTURE, "--model", "faux/faux-1"], {
      cwd: home,
      env: { ...process.env, HOME: home, FAUX_SCRIPT: "plain-text" },
      stdio: ["pipe", "ignore", "inherit"],
    });
    child.on("error", (e) => fail("pi spawn error: " + e.message));
  }, 500);
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  messages.push(msg);
  if (!sessionId && msg.type === "session_added" && msg.session && msg.session.id && !preExisting.has(msg.session.id)) {
    sessionId = msg.session.id;
    ws.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));
    fetch("http://localhost:8000/api/session/" + sessionId + "/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello faux" }),
    })
      .then((r) => {
        if (r.status !== 200) fail("prompt POST status " + r.status);
      })
      .catch((e) => fail("prompt POST failed: " + e.message));
  }
  if (JSON.stringify(messages).includes(MARKER)) {
    done(0, "OK: faux assistant text reached the browser WS");
  }
});

setTimeout(() => fail("timed out waiting for faux text"), 60000);
'

echo "PASS: faux-model prompt round-trip"
