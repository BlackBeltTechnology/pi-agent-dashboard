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
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { buildNodeImportArgvParts, toFileUrl, shouldUrlWrapEntry } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";
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
  /**
   * Whether the new server will boot in dev mode (jiti TS loader).
   * Controls the health-poll deadline embedded in the orchestrator script:
   * - prod: 15s (jiti not involved, server is up well under that)
   * - dev:  60s (cold jiti boot of ~400 TS files can reach 25–60s)
   * Mismatching this against the actual mode is harmless but defeats the
   * point — a too-short deadline writes a spurious failure line to
   * ~/.pi/dashboard/restart.log even though the new server is fine.
   * See change: fix-mode-aware-server-ready-deadlines.
   */
  dev?: boolean;
}

/** Health-poll deadline (ms) for the post-spawn /api/health wait. */
export const RESTART_HEALTH_DEADLINE_PROD_MS = 15_000;
export const RESTART_HEALTH_DEADLINE_DEV_MS = 60_000;

/**
 * Build the JS source (to run via `node -e`) that performs the restart
 * orchestration. Exported for testing. Pure function — no I/O.
 */
export function buildOrchestratorScript(params: RestartParams): string {
  const execPath = params.execPath ?? process.execPath;
  const logPath = path.join(os.homedir(), ".pi", "dashboard", "restart.log");
  const healthDeadlineMs = params.dev
    ? RESTART_HEALTH_DEADLINE_DEV_MS
    : RESTART_HEALTH_DEADLINE_PROD_MS;
  const healthIterations = Math.floor(healthDeadlineMs / 500);
  // Same convention as `server-pid.ts`. Embedded as a JSON-stringified literal
  // so quoting/path-separator handling is correct on Windows.
  // See change: fix-restart-bridge-auto-start-race.
  const pidPath = path.join(os.homedir(), ".pi", "dashboard", "dashboard.pid");
  // Argv shape (loader URL-wrapping + entry URL-wrapping rule) is
  // owned by `buildNodeImportArgvParts` in `node-spawn.ts` — the same
  // helper `spawnNodeScript` calls. Keeps the `--import` argv shape
  // in exactly one place.
  // See change: unify-server-launch-ts-loader.
  // Inject --port BEFORE extraArgs so the actually-bound port survives
  // restart. Without this, the spawned child re-resolves port from CLI
  // > env > file config, falling back to the file default (8000) and
  // losing any `--port` / `PI_DASHBOARD_PORT` override the parent had.
  // Placed BEFORE extraArgs so callers passing their own `--port` in
  // extraArgs win via cli.ts:parseArgs left-to-right semantics (last
  // occurrence wins). See spec server-restart — "Restart orchestrator
  // preserves the bound port". See change: fix-restart-port-loss.
  const startArgs = ["start", "--port", String(params.port), ...params.extraArgs];
  const spawnArgs: string[] = params.loader
    ? buildNodeImportArgvParts({
        loader: params.loader,
        entry: params.cliPath,
        args: startArgs,
      })
    : [
        shouldUrlWrapEntry(params.loader) ? toFileUrl(params.cliPath) : params.cliPath,
        ...startArgs,
      ];

  // The script runs in a fresh Node process. Keep it self-contained and use
  // only built-ins (net, http, fs, child_process). JSON.stringify is used to
  // embed strings safely (handles quotes, backslashes, Windows paths).
  return `
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process"); // ban:child_process-ok — runs in a detached 'node -e' process, not in-host
const fs = require("node:fs");
const path = require("node:path");

const PORT = ${params.port};
const EXEC = ${JSON.stringify(execPath)};
const ARGS = ${JSON.stringify(spawnArgs)};
const LOG_PATH = ${JSON.stringify(logPath)};
const PID_PATH = ${JSON.stringify(pidPath)};
const HEALTH_DEADLINE_MS = ${healthDeadlineMs};
const HEALTH_ITERATIONS = ${healthIterations};

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

// The next three process.kill calls run inside the orchestrator's
// 'node -e' subprocess (NOT in-host server code), so they cannot use
// the platform/process.ts helpers — those modules are not bundled into
// the embedded script. The repo-lint opt-out marker at the end of each
// line keeps no-direct-process-kill.test.ts quiet.
// See change: fix-restart-bridge-auto-start-race.
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; } // ban:process-kill-ok
}

// 0. Read PID file and terminate the previous daemon explicitly. Removes the
// "wait for self-exit" ambiguity that lets bridge auto-start race the
// orchestrator. See change: fix-restart-bridge-auto-start-race.
async function killPriorDaemon() {
  let pid = 0;
  try {
    const raw = fs.readFileSync(PID_PATH, "utf-8").trim();
    pid = parseInt(raw, 10);
  } catch (_) { return; /* no PID file — nothing to do */ }
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (!isAlive(pid)) return;
  try { process.kill(pid, "SIGTERM"); } catch (_) { /* ignore */ } // ban:process-kill-ok
  for (let i = 0; i < 30; i++) { // up to 3 s
    await sleep(100);
    if (!isAlive(pid)) return;
  }
  try { process.kill(pid, "SIGKILL"); } catch (_) { /* ignore */ } // ban:process-kill-ok
  await sleep(200);
}

(async () => {
  // 0. Explicit kill of previous daemon (SIGTERM → SIGKILL).
  await killPriorDaemon();

  // 1. Wait for port to be free (up to 5s — reduced from 10s because step 0
  //    already guarantees the previous server is dead).
  for (let i = 0; i < 10; i++) {
    if (await portFree(PORT)) break;
    await sleep(500);
  }

  // 2. Spawn new server
  const child = spawn(EXEC, ARGS, { detached: true, stdio: "ignore", env: process.env });
  child.unref();

  // 3. Poll health (deadline mode-aware: 15s prod / 60s dev). See change:
  //    fix-mode-aware-server-ready-deadlines.
  for (let i = 0; i < HEALTH_ITERATIONS; i++) {
    await sleep(500);
    if (await healthOk()) {
      process.exit(0);
    }
  }

  log("restart failed: new server did not respond to /api/health within " + (HEALTH_DEADLINE_MS / 1000) + "s");
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
