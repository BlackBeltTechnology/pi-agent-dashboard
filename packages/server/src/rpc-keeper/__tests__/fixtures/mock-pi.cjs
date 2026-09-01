#!/usr/bin/env node
/**
 * Mock pi for keeper integration tests.
 *
 * Reads JSON-line input from stdin and appends each line to the file at
 * `process.env.MOCK_PI_LOG`. Exits 0 on stdin EOF.
 *
 * Behavior modes (via env):
 *   MOCK_PI_MODE=normal (default) — read until EOF, log lines, exit 0
 *   MOCK_PI_MODE=crash             — exit non-zero immediately (tests
 *                                    keeper crash-detection window)
 *   MOCK_PI_MODE=hung              — trap SIGTERM, ignore stdin EOF,
 *                                    busy-loop until SIGKILL. Tests
 *                                    keeper's piChild SIGKILL on shutdown.
 *                                    Writes own PID to MOCK_PI_PID_FILE when set.
 *                                    See change: fix-keeper-kill-escalation.
 *
 * CommonJS-pure, only Node built-ins.
 */
"use strict";

const fs = require("fs");

const mode = process.env.MOCK_PI_MODE || "normal";
const logPath = process.env.MOCK_PI_LOG;

if (mode === "crash") {
  process.stderr.write("[mock-pi] crash mode: exiting 1 immediately\n");
  process.exit(1);
}

if (mode === "hung") {
  // Trap SIGTERM — ignore it. Ignore stdin EOF. Busy-loop forever.
  // The keeper's piChild.kill("SIGKILL") in shutdown() is the only thing
  // that can stop this process.
  process.on("SIGTERM", () => { /* swallow */ });
  process.stdin.on("end", () => { /* swallow EOF, don't exit */ });
  process.stdin.on("error", () => { /* swallow */ });
  process.stdin.resume();
  if (process.env.MOCK_PI_PID_FILE) {
    try { fs.writeFileSync(process.env.MOCK_PI_PID_FILE, String(process.pid)); } catch { /* ignore */ }
  }
  // Keep the event loop busy so we cannot be killed by a graceful exit path.
  setInterval(() => { /* tick */ }, 100);
  return;
}

if (mode === "writer") {
  // Continuous stdout writer for keeper-log rotation tests (E3/E4/E5/P1/P2):
  // writes MOCK_PI_WRITE_CHUNK bytes to stdout every MOCK_PI_WRITE_TICK_MS
  // until MOCK_PI_WRITE_TOTAL bytes have been written (0/absent = forever);
  // once the total is reached, emits MOCK_PI_MARKER every 200 ms so a marker
  // written just before a rotation cannot be the last one erased (E3).
  // ALSO consumes stdin lines like normal mode, so P1 can assert RPC lines
  // keep flowing to MOCK_PI_LOG while the child saturates the shared fd.
  // CommonJS-pure.
  const chunkSize = parseInt(process.env.MOCK_PI_WRITE_CHUNK || "4096", 10);
  const tickMs = parseInt(process.env.MOCK_PI_WRITE_TICK_MS || "5", 10);
  const total = parseInt(process.env.MOCK_PI_WRITE_TOTAL || "0", 10);
  const marker = process.env.MOCK_PI_MARKER || "";
  if (!logPath && !marker) {
    process.stderr.write("[mock-pi] writer mode: MOCK_PI_LOG required for stdin lines\n");
  }
  const chunk = Buffer.alloc(chunkSize, 0x61); // 'a'
  let written = 0;
  let stdinBuf = ""; // own buffer — writer mode returns before normal mode's `let buf`
  // Boot marker: lets tests distinguish "the writer child is emitting" from
  // the keeper's own lifecycle lines (which contain no 'a' — deliberately).
  process.stdout.write("MOCK_PI_WRITER_BOOT\n");
  const writeTimer = setInterval(() => {
    if (total > 0 && written >= total) return; // steady state: markers only
    process.stdout.write(chunk);
    written += chunkSize;
  }, tickMs);
  const markerTimer = setInterval(() => {
    if (marker && (total === 0 || written >= total)) {
      process.stdout.write(marker + "\n");
    }
  }, 200);
  const finish = () => {
    clearInterval(writeTimer);
    clearInterval(markerTimer);
    process.exit(0);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    stdinBuf += c;
    let nl;
    // eslint-disable-next-line no-cond-assign
    while ((nl = stdinBuf.indexOf("\n")) !== -1) {
      const line = stdinBuf.slice(0, nl);
      stdinBuf = stdinBuf.slice(nl + 1);
      if (logPath) fs.appendFileSync(logPath, line + "\n");
    }
  });
  process.stdin.on("end", finish);
  process.stdin.on("error", finish);
  process.stdin.resume();
  return;
}

if (!logPath) {
  process.stderr.write("[mock-pi] FATAL: MOCK_PI_LOG env var required\n");
  process.exit(2);
}

// Dump env to MOCK_PI_ENV_LOG (one VAR=value per line) when set. Used by
// keeper tests to assert that internal env vars (PI_KEEPER_PI_CMD,
// PI_KEEPER_PI_ARGS) are stripped before pi spawn.
// See change: fix-rpc-keeper-pi-resolution.
if (process.env.MOCK_PI_ENV_LOG) {
  const dump = Object.entries(process.env)
    .map(([k, v]) => `${k}=${v ?? ""}`)
    .join("\n");
  try { fs.writeFileSync(process.env.MOCK_PI_ENV_LOG, dump + "\n"); } catch { /* ignore */ }
}

// Emit a recognizable marker to stdout when MOCK_PI_STDOUT is set. Used by
// keeper tests to assert pi stdout routing (captured to keeper log vs
// discarded). See change: add-keeper-output-capture-toggle.
if (process.env.MOCK_PI_STDOUT) {
  process.stdout.write(process.env.MOCK_PI_STDOUT + "\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  // eslint-disable-next-line no-cond-assign
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    fs.appendFileSync(logPath, line + "\n");
  }
});
process.stdin.on("end", () => {
  if (buf.length > 0) {
    fs.appendFileSync(logPath, buf + "\n");
  }
  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
