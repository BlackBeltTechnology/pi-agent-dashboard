/**
 * Server discovery and lifecycle management for Electron.
 * Uses health check → spawn server.
 *
 * NOTE: This module must NOT import from @blackbelt-technology/pi-dashboard-shared
 * or @blackbelt-technology/pi-dashboard-server via dynamic import(). In the packaged
 * Electron app, those packages are inside resources/server/node_modules/ which is NOT
 * on the ESM module resolution path. All config reading and health checking is inlined.
 */
import { spawnDetached } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

import { isDashboardRunning } from "./health-check.js";
import {
  selectLaunchSource,
  spawnFromSource,
  parsePreferOverride,
  PinnedSourceUnavailableError,
  BundledServerMissingError,
} from "./launch-source.js";

/**
 * Pure helper: build the options object passed to spawnDetached for the
 * dashboard-server launch. Extracted for unit testing — keeps the `detach:
 * false` invariant asserted in a pure test without booting Electron.
 *
 * detach: false on Windows keeps the child inside Electron's Job Object, so
 * no new console is allocated (no flash) and the server dies when Electron
 * exits.
 */
export function buildServerSpawnOptions(params: {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  logFd: number | undefined;
}): Parameters<typeof spawnDetached>[0] {
  return {
    cmd: params.cmd,
    args: params.args,
    env: params.env,
    cwd: params.cwd,
    logFd: params.logFd,
    detach: false,
  };
}

let serverStartedByUs = false;

/** PID of the server we spawned in the V2 launch path. Used for ownership check on quit. */
let storedSpawnedPid: number | null = null;

/**
 * Set to `true` immediately before Electron initiates an intentional
 * shutdown (app `before-quit`, programmatic restart). The watchdog inspects
 * this flag to distinguish graceful exits from crashes — a graceful exit
 * MUST NOT trigger the loading-page recovery flow.
 *
 * Reset to `false` after every successful `setSpawnedPid` call so that a
 * programmatic restart (spawn-new-child) re-arms crash detection.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
let gracefulShutdownInProgress = false;

export function setGracefulShutdownInProgress(value: boolean): void {
  gracefulShutdownInProgress = value;
}

export function isGracefulShutdownInProgress(): boolean {
  return gracefulShutdownInProgress;
}

/**
 * Record the PID of the server we spawned (V2 launch path).
 * Called from main.ts after spawnFromSource succeeds. Resets the graceful
 * flag so the watchdog re-arms for the new child.
 */
export function setSpawnedPid(pid: number): void {
  storedSpawnedPid = pid;
  gracefulShutdownInProgress = false;
}

/**
 * Build the watchdog callback passed to `spawnFromSource` (via `onChildExit`)
 * so an unexpected server-child exit routes the user to the loading-page
 * recovery UI.
 *
 * Pure factory — all side-effecting deps are injected so unit tests can
 * verify the graceful-vs-crashed routing decision without booting Electron.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
export function makeServerWatchdog(deps: {
  isGraceful: () => boolean;
  log: (msg: string) => void;
  onCrash: (code: number | null, signal: NodeJS.Signals | null) => void;
}): (code: number | null, signal: NodeJS.Signals | null) => void {
  return (code, signal) => {
    if (deps.isGraceful()) {
      deps.log(
        `[server-lifecycle] server child exited gracefully code=${code} signal=${signal ?? "null"}`,
      );
      return;
    }
    deps.log(
      `[server-lifecycle] server child exited unexpectedly code=${code} signal=${signal ?? "null"} — routing to recovery`,
    );
    try {
      deps.onCrash(code, signal);
    } catch (err) {
      deps.log(
        `[server-lifecycle] crash handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
}

/**
 * Pure helper: should Electron stop the server on quit?
 * Rule: only stop when starter is "Electron" AND pid matches what we spawned.
 */
export function decideShutdownOnQuit(params: {
  starter: string | undefined;
  healthPid: number | undefined;
  storedPid: number | null;
}): boolean {
  if (params.storedPid === null) return false;
  return params.starter === "Electron" && params.healthPid === params.storedPid;
}

/** Did Electron start the server this session? */
export function didWeStartServer(): boolean {
  return serverStartedByUs;
}

/**
 * Server-startup deadline used by both `launchViaCli` and `launchServer`.
 * History: 15s → 60s in `fix-electron-windows-installer-and-server-bootstrap`
 * to give `installStandalone()` + offline-cacache extraction headroom on first
 * launch. Tightened back to 15s in `tighten-electron-server-startup-deadline`
 * because beyond ~15s the failure is almost always terminal (port conflict,
 * missing loader, bad Node) and the interactive loading page (resources/
 * loading.html) is a strictly better surface than a frozen splash — it polls
 * indefinitely and exposes Start server / Doctor / log-tail controls.
 */
export const SERVER_READY_DEADLINE_MS = 15_000;

/**
 * Construct a cause-aware server-startup failure message. Distinguishes
 * "child process exited prematurely" from "deadline elapsed without
 * probe returning true". The pre-fix message conflated both cases under
 * "Server failed to start within 15 seconds (child exited with code N)",
 * which was misleading because the child-exit case never reaches the
 * deadline. Pure helper, exported for tests. See change:
 * fix-electron-windows-installer-and-server-bootstrap (Defect 4 / D4).
 */
export function buildServerStartupError(args: {
  cliPath?: string;
  spawnBin?: string;
  spawnArgs?: string[];
  cwd: string;
  logTail: string;
  readyError: string;
  port?: number;
  piPort?: number;
}): Error {
  const isChildExit = args.readyError.toLowerCase().includes("exit");
  const cmdLine = args.cliPath
    ? `Command: ${args.cliPath} start --port ${args.port ?? "?"} --pi-port ${args.piPort ?? "?"}`
    : `Command: ${args.spawnBin ?? "?"} ${(args.spawnArgs ?? []).join(" ")}`;
  const header = isChildExit
    ? `Server child process exited prematurely (${args.readyError}).\n` +
      `This usually means a missing dependency or wrong TypeScript loader.\n`
    : `Server did not respond within 15 seconds (${args.readyError}).\n` +
      `The server is likely still starting; the loading page will keep polling — try the Doctor button if it doesn't connect.\n`;
  const body =
    `${cmdLine}\n` +
    `CWD: ${args.cwd}\n` +
    (args.logTail ? `\nServer log:\n${args.logTail}` : "\nNo server log available.");
  return new Error(header + body);
}

// ── Inlined config reading (replaces @blackbelt-technology/pi-dashboard-shared/config) ──

interface KnownServerEntry {
  host: string;
  port: number;
  label?: string;
}

interface MinimalConfig {
  port: number;
  piPort: number;
  knownServers: KnownServerEntry[];
}

export function loadMinimalConfig(): MinimalConfig {
  const defaults: MinimalConfig = { port: 8000, piPort: 9999, knownServers: [] };
  try {
    const configFile = path.join(os.homedir(), ".pi", "dashboard", "config.json");
    if (!existsSync(configFile)) return defaults;
    const raw = readFileSync(configFile, "utf-8").trim();
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const knownServers: KnownServerEntry[] = Array.isArray(parsed.knownServers)
      ? parsed.knownServers.filter((s: any) => s && typeof s.host === "string" && typeof s.port === "number")
          .map((s: any) => ({ host: s.host, port: s.port, ...(typeof s.label === "string" ? { label: s.label } : {}) }))
      : [];
    return {
      port: typeof parsed.port === "number" ? parsed.port : defaults.port,
      piPort: typeof parsed.piPort === "number" ? parsed.piPort : defaults.piPort,
      knownServers,
    };
  } catch {
    return defaults;
  }
}

// Health check imported from ./health-check.ts

// ── Server discovery and launch ────────────────────────────────────────────────

/**
 * Discover or launch the dashboard server using the immutable-bundle
 * resolver (`selectLaunchSource` + `spawnFromSource`).
 *
 * Returns the URL to connect to. Throws on bundled-server-missing /
 * pinned-source-unavailable / spawn failure.
 *
 * Used by `requestServerLaunch` (loading-page "Start server" + tray menu).
 * The Electron `main.ts` startup flow does NOT call this — it drives the
 * resolver directly so it can wire the watchdog at spawn time.
 */
export async function ensureServer(): Promise<string> {
  const config = loadMinimalConfig();

  const status = await isDashboardRunning(config.port);
  if (status.running) return `http://localhost:${config.port}`;

  if (status.portConflict) {
    throw new Error(
      `Port ${config.port} is in use by another service. Change the dashboard port in ~/.pi/dashboard/config.json`,
    );
  }

  const source = await selectLaunchSource({
    isPackaged: process.resourcesPath !== process.execPath,
    cwd: process.cwd(),
    preferOverride: parsePreferOverride(process.env),
    resourcesPath: (process as any).resourcesPath ?? "",
    port: config.port,
  });

  if (source.kind === "attach") {
    // Race with health check above — accept and return.
    return source.url;
  }

  const spawned = await spawnFromSource(
    source as Exclude<typeof source, { kind: "attach" }>,
    { port: config.port, piPort: config.piPort },
    { logFile: getDashboardServerLogPath() },
  );
  setSpawnedPid(spawned.pid);
  serverStartedByUs = true;
  return `http://localhost:${config.port}`;
}

// ── Legacy launch functions removed under change: eliminate-electron-runtime-install.
// `selectLaunchSource` + `spawnFromSource` (in launch-source.ts) are the
// single spawn path now used by `ensureServer` above.


// ── User-initiated launch routine ──────────────────────────────────────────────
//
// `requestServerLaunch` is the single entry point shared by the loading-page
// "Start server" button, tray menu items, and any future in-app launch
// controls. It is idempotent under concurrent invocation: a single shared
// promise is reused while a launch is in flight.
// See change: electron-server-launch-controls (D1).

export type LaunchOutcome =
  | { kind: "already-running"; url: string }
  | { kind: "started"; url: string }
  | { kind: "failed"; reason: string; logTail: string };

export type LaunchStatus =
  | { phase: "starting" }
  | { phase: "shutting-down-existing" }
  | { phase: "spawning" }
  | { phase: "waiting-health" }
  | { phase: "ready"; url: string }
  | { phase: "failed"; message: string };

type LaunchStatusListener = (status: LaunchStatus) => void;
const launchStatusListeners = new Set<LaunchStatusListener>();

/** Subscribe to launch-status events. Returns an unsubscribe function. */
export function onLaunchStatus(cb: LaunchStatusListener): () => void {
  launchStatusListeners.add(cb);
  return () => { launchStatusListeners.delete(cb); };
}

function emitLaunchStatus(status: LaunchStatus): void {
  for (const cb of launchStatusListeners) {
    try { cb(status); } catch { /* listener errors are not our problem */ }
  }
}

let inflightLaunch: Promise<LaunchOutcome> | null = null;

/**
 * Probe whether the dashboard server is currently reachable.
 * Thin wrapper around `isDashboardRunning` that reads the configured port.
 */
export async function isManagedServerRunning(): Promise<boolean> {
  const config = loadMinimalConfig();
  const status = await isDashboardRunning(config.port);
  return status.running;
}

/**
 * Read the trailing `lines` lines (default 20) of `~/.pi/dashboard/server.log`.
 * Returns an empty string if the log is missing or unreadable. Reads at most
 * 8 KiB from the end of the file to bound memory.
 */
export async function readServerLogTail(lines: number = 20): Promise<string> {
  const logPath = getDashboardServerLogPath();
  try {
    if (!existsSync(logPath)) return "";
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(logPath);
    const TAIL_BYTES = 8192;
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = await fs.open(logPath, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      await fd.read(buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      const allLines = text.split("\n");
      return allLines.slice(-lines).join("\n");
    } finally {
      await fd.close();
    }
  } catch {
    return "";
  }
}

/**
 * User-initiated server launch. Idempotent under concurrent calls.
 * Never throws — failures are returned as `{ kind: "failed", reason, logTail }`.
 */
export async function requestServerLaunch(opts: { force?: boolean } = {}): Promise<LaunchOutcome> {
  if (inflightLaunch) return inflightLaunch;
  inflightLaunch = (async (): Promise<LaunchOutcome> => {
    try {
      emitLaunchStatus({ phase: "starting" });
      const config = loadMinimalConfig();
      const url = `http://localhost:${config.port}`;
      const status = await isDashboardRunning(config.port);

      if (status.running && !opts.force) {
        emitLaunchStatus({ phase: "ready", url });
        return { kind: "already-running", url };
      }

      if (status.running && opts.force) {
        emitLaunchStatus({ phase: "shutting-down-existing" });
        try {
          await fetch(`${url}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
        } catch { /* fall through; spawn will report port conflict if anything */ }
        // Wait up to 5s for the port to close.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const probe = await isDashboardRunning(config.port);
          if (!probe.running) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      emitLaunchStatus({ phase: "spawning" });
      const startedUrl = await ensureServer();
      emitLaunchStatus({ phase: "waiting-health" });
      // ensureServer already waits for health internally — emit ready.
      emitLaunchStatus({ phase: "ready", url: startedUrl });
      return { kind: "started", url: startedUrl };
    } catch (err: any) {
      const reason = String(err?.message ?? err);
      const logTail = await readServerLogTail(20);
      emitLaunchStatus({ phase: "failed", message: reason });
      return { kind: "failed", reason, logTail };
    } finally {
      inflightLaunch = null;
    }
  })();
  return inflightLaunch;
}

/** Stop the server if we started it and own it. */
export async function stopServerIfNeeded(): Promise<void> {
  const config = loadMinimalConfig();
  const port = config.port;

  // V2 path: use health-based ownership check.
  if (storedSpawnedPid !== null) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const shouldStop = decideShutdownOnQuit({
          starter: typeof data.starter === "string" ? data.starter : undefined,
          healthPid: typeof data.pid === "number" ? data.pid : undefined,
          storedPid: storedSpawnedPid,
        });
        if (shouldStop) {
          try {
            await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });
          } catch { /* already stopped */ }
        }
      }
    } catch { /* server not reachable — already stopped */ }
    return;
  }

  // Legacy path: use serverStartedByUs flag.
  if (!serverStartedByUs) return;
  try {
    await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });
  } catch { /* already stopped */ }
}
