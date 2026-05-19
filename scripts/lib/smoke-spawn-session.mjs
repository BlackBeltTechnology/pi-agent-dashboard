#!/usr/bin/env node
/**
 * scripts/lib/smoke-spawn-session.mjs
 *
 * Test helper: connect to a running dashboard's browser WebSocket
 * (`/ws`), send a `spawn_session` for the given cwd, and wait for
 * confirmation that the session registered. Used by the Docker smoke
 * (`scripts/test-standalone-npm-install-docker.sh`) to verify the
 * full pi-spawn round-trip works on a clean install.
 *
 * Why a Node helper rather than inline bash:
 *   - WebSocket from bash needs `wscat` or `websocat`, neither of which
 *     ship in `node:22-bookworm-slim`. Node 22+ ships a global
 *     `WebSocket` so the smoke needs no extra system packages.
 *   - The protocol is shaped: send `spawn_session`, observe
 *     `spawn_result` (preflight ok/fail), then await
 *     `session_register` (session reached the bridge). Sequencing is
 *     non-trivial; encoding it as a node script keeps it testable
 *     and inspectable.
 *
 * Usage:
 *   node smoke-spawn-session.mjs --url ws://localhost:18000/ws --cwd /tmp/smoke-cwd [--timeout 60]
 *
 * Exits 0 on session_register received. Exits 1 with a diagnostic
 * message otherwise. Exits 2 on usage error.
 *
 * Output is one line per state transition prefixed `[spawn]` so the
 * outer smoke script can echo-through without parsing.
 *
 * See change: enable-standalone-npm-install (Docker smoke session check).
 */

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.cwd) {
  process.stderr.write(
    "Usage: smoke-spawn-session.mjs --url <ws-url> --cwd <abs-path> [--timeout <sec>]\n",
  );
  process.exit(2);
}
const TIMEOUT_MS = (args.timeout ? Number(args.timeout) : 60) * 1000;
const REQ_ID = "smoke-" + Date.now().toString(36);

let resolved = false;
const ws = new WebSocket(args.url);

const deadline = setTimeout(() => {
  if (!resolved) {
    console.error(`[spawn] FAIL: no session_register within ${TIMEOUT_MS}ms (reqId=${REQ_ID})`);
    try { ws.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}, TIMEOUT_MS);

ws.addEventListener("open", () => {
  console.log(`[spawn] ws open → sending spawn_session cwd=${args.cwd} reqId=${REQ_ID}`);
  ws.send(JSON.stringify({
    type: "spawn_session",
    cwd: args.cwd,
    requestId: REQ_ID,
  }));
});

ws.addEventListener("error", (e) => {
  if (!resolved) {
    console.error(`[spawn] FAIL: ws error: ${e?.message ?? "(no message)"}`);
    try { ws.close(); } catch { /* ignore */ }
    clearTimeout(deadline);
    process.exit(1);
  }
});

ws.addEventListener("close", (e) => {
  if (!resolved) {
    console.error(`[spawn] FAIL: ws closed before session_register (code=${e.code} reason=${e.reason || "(none)"})`);
    clearTimeout(deadline);
    process.exit(1);
  }
});

/**
 * Track observed events so failure messages can include the trail.
 * Bounded so a chatty server doesn't blow up memory.
 */
const trail = [];
const TRAIL_MAX = 50;

ws.addEventListener("message", (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  // Record everything terse for the trail.
  const summary = { type: msg.type };
  if (msg.sessionId) summary.sessionId = msg.sessionId.slice(0, 8);
  if (msg.cwd) summary.cwd = msg.cwd;
  if (msg.success !== undefined) summary.success = msg.success;
  if (msg.requestId) summary.requestId = msg.requestId;
  if (trail.push(summary) > TRAIL_MAX) trail.shift();

  // spawn_result: preflight passed/failed for OUR request.
  if (msg.type === "spawn_result" && msg.requestId === REQ_ID) {
    if (!msg.success) {
      console.error(`[spawn] FAIL: spawn_result success=false message="${msg.message || "(none)"}"`);
      try { ws.close(); } catch { /* ignore */ }
      clearTimeout(deadline);
      process.exit(1);
    }
    console.log(`[spawn] spawn_result success=true`);
    return;
  }

  // spawn_error: preflight or spawn-time failure.
  if (msg.type === "spawn_error" && msg.cwd === args.cwd) {
    console.error(
      `[spawn] FAIL: spawn_error code=${msg.code || "?"} message="${msg.message || "(none)"}"`,
    );
    try { ws.close(); } catch { /* ignore */ }
    clearTimeout(deadline);
    process.exit(1);
  }

  // session_register OR session_added: the bridge has connected back to
  // the server. This is the definitive "session is live" signal.
  // session_added carries `spawnRequestId` echoing our REQ_ID when the
  // server runs a recent-enough version; older servers omit it but the
  // cwd match is sufficient for the smoke.
  const isAdded = msg.type === "session_added" && msg.session?.cwd === args.cwd;
  const isRegister = msg.type === "session_register" && msg.cwd === args.cwd;
  if (isAdded || isRegister) {
    const sid = (msg.session?.id ?? msg.sessionId ?? "<unknown>").slice(0, 8);
    console.log(`[spawn] ✓ session live: type=${msg.type} sid=${sid} cwd=${args.cwd}`);
    resolved = true;
    clearTimeout(deadline);
    try { ws.close(); } catch { /* ignore */ }
    process.exit(0);
  }
});

// ── argv parser ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") { out.url = argv[++i]; continue; }
    if (a === "--cwd") { out.cwd = argv[++i]; continue; }
    if (a === "--timeout") { out.timeout = argv[++i]; continue; }
    process.stderr.write(`unknown arg: ${a}\n`);
    process.exit(2);
  }
  return out;
}
