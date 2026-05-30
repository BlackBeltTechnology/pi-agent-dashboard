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
