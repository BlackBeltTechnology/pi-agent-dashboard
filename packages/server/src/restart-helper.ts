/**
 * Cross-platform restart helper for POST /api/restart.
 *
 * Replaces the previous `sh -c` script that depended on `lsof` and `curl` —
 * neither of which exists on Windows. The new implementation spawns a
 * detached plain-Node orchestrator (via `node -e`) that:
 *   1. Polls the port via net.createConnection until free
 *   2. Spawns the new server with the same loader + args as the current run
 *   3. Polls /api/health via http.get until it returns ok
 *   4. On failure, appends a line to ~/.pi/dashboard/restart.log
 *
 * See change: fix-windows-server-parity.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface RestartParams {
  /** Absolute path to the server CLI (typically process.argv[1]) */
  cliPath: string;
  /** Loader value from --import (e.g. file:// URL). Empty string = none. */
  loader: string;
  /** Port the server listens on */
  port: number;
  /** Extra args to pass to `cli start` (e.g. ["--dev"]) */
  extraArgs: string[];
  /** Override Node binary (defaults to process.execPath) */
  execPath?: string;
}

/**
 * Build the JS source (to run via `node -e`) that performs the restart
 * orchestration. Exported for testing. Pure function — no I/O.
 */
export function buildOrchestratorScript(params: RestartParams): string {
  const execPath = params.execPath ?? process.execPath;
  const logPath = path.join(os.homedir(), ".pi", "dashboard", "restart.log");
  const spawnArgs: string[] = [];
  if (params.loader) {
    spawnArgs.push("--import", params.loader);
  }
  spawnArgs.push(params.cliPath, "start", ...params.extraArgs);

  // The script runs in a fresh Node process. Keep it self-contained and use
  // only built-ins (net, http, fs, child_process). JSON.stringify is used to
  // embed strings safely (handles quotes, backslashes, Windows paths).
  return `
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = ${params.port};
const EXEC = ${JSON.stringify(execPath)};
const ARGS = ${JSON.stringify(spawnArgs)};
const LOG_PATH = ${JSON.stringify(logPath)};

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, "[" + new Date().toISOString() + "] " + msg + "\\n");
  } catch (_) { /* ignore */ }
}

function portFree(port) {
  return new Promise(resolve => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    let done = false;
    const finish = (free) => { if (done) return; done = true; try { sock.destroy(); } catch(_){} resolve(free); };
    sock.setTimeout(500);
    sock.once("connect", () => finish(false));
    sock.once("error", () => finish(true));
    sock.once("timeout", () => finish(true));
  });
}

function healthOk() {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 1000 }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.once("error", () => resolve(false));
    req.once("timeout", () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // 1. Wait for port to be free (up to 10s)
  for (let i = 0; i < 20; i++) {
    if (await portFree(PORT)) break;
    await sleep(500);
  }

  // 2. Spawn new server
  const child = spawn(EXEC, ARGS, { detached: true, stdio: "ignore", env: process.env });
  child.unref();

  // 3. Poll health (up to 10s)
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await healthOk()) {
      process.exit(0);
    }
  }

  log("restart failed: new server did not respond to /api/health within 10s");
  process.exit(1);
})();
`;
}

/**
 * Spawn a detached orchestrator child that restarts the server.
 * Returns immediately (the caller is expected to exit shortly after).
 */
export function spawnRestart(params: RestartParams): void {
  const script = buildOrchestratorScript(params);
  const execPath = params.execPath ?? process.execPath;
  const child = spawn(execPath, ["-e", script], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
    windowsHide: true,
  });
  child.unref();
}
