/**
 * Server discovery and lifecycle management for Electron.
 * Uses health check → spawn server.
 *
 * NOTE: This module must NOT import from @blackbelt-technology/pi-dashboard-shared
 * or @blackbelt-technology/pi-dashboard-server via dynamic import(). In the packaged
 * Electron app, those packages are inside resources/server/node_modules/ which is NOT
 * on the ESM module resolution path. All config reading and health checking is inlined.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { starterFromHealth } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import { ELECTRON_RESTART_EXIT_CODE } from "@blackbelt-technology/pi-dashboard-shared/electron-restart.js";
import type { spawnDetached } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { isDashboardRunning } from "./health-check.js";
import {
  BundledServerMissingError,
  PinnedSourceUnavailableError,
  parsePreferOverride,
} from "./launch-source.js";
import { localApiBase, localProofHeaders } from "./local-proof-bootstrap.js";
import { takeExitOwnership } from "./runtime-switch-ownership.js";
import { readModeFile } from "./wizard-state.js";

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
// Runtime-switch PID ownership lives in a leaf module; re-exported here for
// existing importers. See change: electron-runtime-overlay-updates.
export { claimCandidate, expectExit, releaseRuntimeSwitchOwnership } from "./runtime-switch-ownership.js";

export function makeServerWatchdog(deps: {
  isGraceful: () => boolean;
  log: (msg: string) => void;
  onCrash: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Server exited with ELECTRON_RESTART_EXIT_CODE (`/api/restart`): respawn, no recovery page. */
  onRestartRequested?: () => void;
  /** PID of the child this watchdog guards; enables PID-scoped ownership. */
  getPid?: () => number | null | undefined;
}): (code: number | null, signal: NodeJS.Signals | null) => void {
  return (code, signal) => {
    const pid = deps.getPid?.();
    const owner = typeof pid === "number" ? takeExitOwnership(pid) : "watchdog";
    if (owner === "candidate") {
      deps.log(`[server-lifecycle] candidate pid=${pid} exited code=${code} — handled by runtime switch`);
      return;
    }
    if (owner === "planned") {
      deps.log(`[server-lifecycle] server pid=${pid} exited as planned (runtime switch)`);
      return;
    }
    if (code === ELECTRON_RESTART_EXIT_CODE && deps.onRestartRequested) {
      deps.log(`[server-lifecycle] server pid=${pid ?? "?"} exited for /api/restart — restarting it`);
      deps.onRestartRequested();
      return;
    }
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

/**
 * Effective launch-source union as reported by `/api/health.launchSourceEffective`.
 * Declared locally (not imported from the server package) because this Electron
 * module must not resolve `@blackbelt-technology/pi-dashboard-server` at runtime
 * (it lives in resources/server/node_modules, off the ESM path).
 */
export type HealthLaunchSourceEffective =
  | "electron"
  | "standalone"
  | "bridge"
  | "bridge-orphaned";

/**
 * Pure helper: classify who owns the reachable server, from the tray probe's
 * point of view. Consumes `launchSourceEffective` (so a bridge-orphaned server
 * classifies as foreign, not electron).
 *
 * - `null` health (server unreachable) → "none".
 * - server reachable but not spawned by this Electron lifetime, or
 *   launchSourceEffective !== "electron", or pid mismatch → "foreign".
 * - launchSourceEffective === "electron" AND pid === storedSpawnedPid →
 *   "electron".
 *
 * See change: electron-attach-ownership-fixes.
 */
export function decideOwnership(params: {
  healthLaunchSource: HealthLaunchSourceEffective | null;
  healthPid: number | undefined;
  storedSpawnedPid: number | null;
}): "electron" | "foreign" | "none" {
  if (params.healthLaunchSource === null) return "none";
  if (params.storedSpawnedPid === null) return "foreign";
  if (params.healthLaunchSource !== "electron") return "foreign";
  if (params.healthPid !== params.storedSpawnedPid) return "foreign";
  return "electron";
}

/**
 * Pure helper: is the reachable server a zombie left over from a prior Electron
 * lifetime? Platform-branched; all liveness is precomputed server-side into
 * `healthBootParentAlive` (the server, not Electron, holds the Tier-2 handle).
 *
 * Common gates (all platforms): launchSourceEffective === "electron" AND we did
 * not spawn it this lifetime (storedSpawnedPid === null).
 *
 * - POSIX: AND reparented away (`ppid !== bootParentPid`) AND the boot parent
 *   is gone (`bootParentAlive === false`). NOT `ppid === 1` (unreliable under
 *   Linux subreapers / containers).
 * - Windows: AND `bootParentAlive === false` (Windows never reparents, so
 *   liveness of the boot parent is the whole signal; the Job Object covers the
 *   common crash path, this catches the bypass cases).
 *
 * See change: electron-attach-ownership-fixes.
 */
export function decideIsZombie(params: {
  healthLaunchSourceEffective: HealthLaunchSourceEffective | null;
  healthPid: number | undefined;
  healthPpid: number | undefined;
  healthBootParentPid: number | undefined;
  healthBootParentAlive: boolean | undefined;
  storedSpawnedPid: number | null;
  platform: NodeJS.Platform;
}): boolean {
  if (params.storedSpawnedPid !== null) return false;
  if (params.healthLaunchSourceEffective !== "electron") return false;
  if (params.platform === "win32") {
    return params.healthBootParentAlive === false;
  }
  // POSIX
  return (
    params.healthPpid !== params.healthBootParentPid &&
    params.healthBootParentAlive === false
  );
}

// ── Attach-time version-skew decision ───────────────────────────────────────

/** Subset of `/api/health` the attach decision reads. */
export interface AttachHealth {
  version?: string;
  /** Static launch source (what the fix text is chosen from). */
  launchSource?: string;
  /** Ownership classification (what restart eligibility is chosen from). */
  launchSourceEffective?: string;
  /** Legacy starter label of older servers. */
  starter?: string;
  bootParentAlive?: boolean;
}

/** One dismissed skew notice: the pair plus the launch source its fix text came from. */
export interface VersionSkewPair {
  server: string;
  expected: string;
  launchSource: string;
}

export type AttachAction =
  | { action: "none" }
  | { action: "zombie" }
  | { action: "skew-restart"; restartIsDefault: boolean }
  | { action: "skew-zombie-merged" }
  | { action: "skew-info" };

/** Trim + strip a leading `v`; empty / `unknown` / absent → null (unknown). */
export function normalizeVersion(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const n = v.trim().replace(/^v+/i, "");
  return n === "" || n.toLowerCase() === "unknown" ? null : n;
}

/** Launch source the dismissal key and fix text use: static source, else legacy starter, else "unknown". */
export function dismissalLaunchSource(health: AttachHealth): string {
  return health.launchSource || health.starter?.toLowerCase() || "unknown";
}

/**
 * Pure attach-time decision (zombie + version skew in one place); `main.ts`
 * only executes the result. Skew needs a packaged app and two known versions
 * that differ (any inequality; no semver ordering). `launchSourceEffective ===
 * "electron"` → restart offered; anything else (incl. unknown) → info only.
 * See change: electron-attach-version-skew (D2, D2b).
 */
export function decideAttachAction(params: {
  health: AttachHealth;
  expectedVersion: string | null;
  isZombie: boolean;
  isPackaged: boolean;
  isDismissed: (pair: VersionSkewPair) => boolean;
}): AttachAction {
  const { health } = params;
  const server = normalizeVersion(health.version);
  const expected = normalizeVersion(params.expectedVersion);
  const skewed = params.isPackaged && server !== null && expected !== null && server !== expected;
  if (params.isZombie) return skewed ? { action: "skew-zombie-merged" } : { action: "zombie" };
  if (!skewed) return { action: "none" };
  if (health.launchSourceEffective === "electron") {
    return { action: "skew-restart", restartIsDefault: health.bootParentAlive === false };
  }
  const pair = { server, expected, launchSource: dismissalLaunchSource(health) };
  return params.isDismissed(pair) ? { action: "none" } : { action: "skew-info" };
}

/** Did Electron start the server this session? */
export function didWeStartServer(): boolean {
  return serverStartedByUs;
}

/**
 * Read-only accessor for the module-private `storedSpawnedPid`. Used by the
 * tray ownership probe and the zombie-detection gate in main.ts.
 * See change: electron-attach-ownership-fixes.
 */
export function getStoredSpawnedPid(): number | null {
  return storedSpawnedPid;
}

// Server-startup deadline constants + helper live in `launch-source.ts`
// (canonical definition site — the actual `healthTimeoutMs` call lives there).
// Re-exported here so existing callers / tests that import from
// `server-lifecycle.ts` keep working. See change:
// fix-mode-aware-server-ready-deadlines.
export {
  getServerReadyDeadlineMs,
  SERVER_READY_DEADLINE_DEV_MS,
  SERVER_READY_DEADLINE_MS,
} from "./launch-source.js";

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
  /** The host the dashboard binds (config.json `bindHost`); main-process calls dial `localDialHost(host)`. */
  host?: string;
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
      // The persisted field is `bindHost` (shared `DashboardConfig`), not `host`.
      ...(typeof parsed.bindHost === "string" && parsed.bindHost ? { host: parsed.bindHost } : {}),
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
/**
 * Spawner used by `ensureServer` — main.ts injects the runtime-overlay-aware
 * resolver (`resolveAndSpawnRuntime`). Injected, not imported, so this module
 * stays free of an import cycle with runtime-overlay-main.
 * See change: electron-runtime-overlay-updates.
 */
export type LocalServerSpawner = (opts: {
  isPackaged: boolean;
  cwd: string;
  preferOverride: ReturnType<typeof parsePreferOverride>;
  resourcesPath: string;
  port: number;
  piPort: number;
  logFile: string;
}) => Promise<{ kind: "attach"; url: string } | { kind: "spawned"; pid: number }>;

let localServerSpawner: LocalServerSpawner | null = null;

export function setLocalServerSpawner(spawner: LocalServerSpawner): void {
  localServerSpawner = spawner;
}

export async function ensureServer(): Promise<string> {
  // Remote mode: attach to the configured URL directly. No discovery, no
  // health probe, no spawn — and `serverStartedByUs` stays false so quit
  // never stops the remote server. See change: docker-packaging.
  const modeConfig = readModeFile();
  if (modeConfig?.mode === "remote" && modeConfig.remoteUrl) {
    return modeConfig.remoteUrl;
  }

  const config = loadMinimalConfig();

  const status = await isDashboardRunning(config.port);
  if (status.running) return `http://localhost:${config.port}`;

  if (status.portConflict) {
    throw new Error(
      `Port ${config.port} is in use by another service. Change the dashboard port in ~/.pi/dashboard/config.json`,
    );
  }

  if (!localServerSpawner) throw new Error("No local server spawner configured (main.ts wires it at startup).");
  const launched = await localServerSpawner({
    isPackaged: process.resourcesPath !== process.execPath,
    cwd: process.cwd(),
    preferOverride: parsePreferOverride(process.env),
    resourcesPath: (process as any).resourcesPath ?? "",
    port: config.port,
    piPort: config.piPort,
    logFile: getDashboardServerLogPath(),
  });

  if (launched.kind === "attach") {
    // Race with health check above — accept and return.
    return launched.url;
  }
  setSpawnedPid(launched.pid);
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

/** Poll cadence / graceful-exit budget of the force-restart PID wait. */
const FORCE_POLL_MS = 200;
const FORCE_GRACEFUL_MS = 5000;

/** I/O the force-restart branch needs; injected by tests, real by default. */
export interface ForceRestartDeps {
  /** PID of the server answering `/api/health`, or null when unknown. */
  readServerPid: (port: number) => Promise<number | null>;
  /** Graceful `/api/shutdown` (local proof). Failure is swallowed by the caller. */
  postShutdown: (port: number) => Promise<void>;
  isAlive: (pid: number) => boolean;
  /** Signal ladder SIGTERM → SIGKILL; true only when the PID is confirmed gone. */
  stopProcess: (pid: number) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
}

async function defaultReadServerPid(port: number): Promise<number | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { pid?: unknown };
    return typeof body.pid === "number" ? body.pid : null;
  } catch {
    return null;
  }
}

function defaultForceRestartDeps(): ForceRestartDeps {
  const isAlive = (pid: number) => isProcessAlive(pid, { epermAlive: true });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    readServerPid: defaultReadServerPid,
    postShutdown: async (port) => {
      const shutdownUrl = `${localApiBase({ port, host: loadMinimalConfig().host })}/api/shutdown`;
      await fetch(shutdownUrl, { method: "POST", headers: localProofHeaders("POST", shutdownUrl), signal: AbortSignal.timeout(3000) });
    },
    isAlive,
    stopProcess: async (pid) => {
      // Lazy: zombie-adoption-dialog imports `electron`; keep this module electron-free at load.
      const { stopZombieServer } = await import("./zombie-adoption-dialog.js");
      return stopZombieServer(pid, {
        kill: (p, signal) => process.kill(p, signal), // ban:process-kill-ok
        isAlive,
        sleep,
      });
    },
    sleep,
  };
}

/**
 * Stop the running server for a forced restart and CONFIRM it is gone. Waits
 * on the old PID (not the port): graceful `/api/shutdown`, ≤5 s of PID polling,
 * then the signal ladder. Returns a failure reason, or null when it is safe to
 * spawn. A server still answering the port after the PID is gone (a foreign
 * server) is a failure, never "started".
 * See change: electron-attach-version-skew (D4).
 */
async function stopServerForRestart(port: number, deps: ForceRestartDeps): Promise<string | null> {
  const oldPid = await deps.readServerPid(port);
  try {
    await deps.postShutdown(port);
  } catch { /* fall through: the wait below decides */ }

  if (oldPid !== null) {
    let gone = false;
    for (let waited = 0; waited < FORCE_GRACEFUL_MS; waited += FORCE_POLL_MS) {
      if (!deps.isAlive(oldPid)) { gone = true; break; }
      await deps.sleep(FORCE_POLL_MS);
    }
    if (!gone && !deps.isAlive(oldPid)) gone = true;
    if (!gone && !(await deps.stopProcess(oldPid))) {
      return `Could not stop the running dashboard server (PID ${oldPid}); it is still alive.`;
    }
  } else {
    // PID unknown: fall back to waiting for the port to close.
    for (let waited = 0; waited < FORCE_GRACEFUL_MS; waited += FORCE_POLL_MS) {
      if (!(await isDashboardRunning(port)).running) break;
      await deps.sleep(FORCE_POLL_MS);
    }
  }

  const survivor = await isDashboardRunning(port);
  if (survivor.running) {
    const pid = await deps.readServerPid(port);
    return `Another dashboard server${pid !== null ? ` (PID ${pid})` : ""} is still answering on port ${port}; not starting a new one.`;
  }
  return null;
}

/**
 * User-initiated server launch. Idempotent under concurrent calls.
 * Never throws — failures are returned as `{ kind: "failed", reason, logTail }`.
 * `force` stops the running server first and only spawns once its PID is gone.
 */
export async function requestServerLaunch(
  opts: { force?: boolean; deps?: Partial<ForceRestartDeps> } = {},
): Promise<LaunchOutcome> {
  // Explicit nullish check: a `Promise` is always truthy, so the bare guard was
  // correct only by accident. Narrowing preserves the inflight memoization
  // exactly — do not `await` here, the caller awaits the shared promise.
  // See change: cleanup-async-semantics-server-extension (design D4).
  if (inflightLaunch !== null) return inflightLaunch;
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
        const failure = await stopServerForRestart(config.port, { ...defaultForceRestartDeps(), ...opts.deps });
        if (failure) {
          emitLaunchStatus({ phase: "failed", message: failure });
          return { kind: "failed", reason: failure, logTail: await readServerLogTail(20) };
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

/**
 * Body for the quit-path `/api/shutdown`. Declares that a USER closed the app,
 * as opposed to a dev-reload / force-relaunch shutdown (which leaves the pi
 * sessions running and expects them to reattach). The server records it as the
 * `user-quit` exit intent, which does NOT suppress cold-start recovery: if the
 * quit took the sessions down with it they can never reattach and deserve an
 * offer; if they survived, the next boot's liveness gate retracts them.
 * See change: fix-recovery-exit-intent (task 3.6).
 */
const userQuitShutdownInit = (url: string): RequestInit => ({
  method: "POST",
  // A fresh single-use proof per request, bound to the literal `url` dialled.
  headers: { "content-type": "application/json", ...localProofHeaders("POST", url) },
  body: JSON.stringify({ userQuit: true }),
});

/** Poll interval / cap for the quit-time wait on the server's exit (design D7). */
const QUIT_EXIT_POLL_MS = 200;
const QUIT_EXIT_WAIT_MS = 5000;

/**
 * Wait until `/api/health` stops answering (the server exited), polling every
 * 200 ms for at most 5 s. `dashboard-starter-identity` requires quit to await
 * the server's exit. Never throws; a cap expiry just returns.
 * See change: fix-cli-control-electron-server (design D7).
 */
async function waitForServerExit(base: string): Promise<void> {
  const deadline = Date.now() + QUIT_EXIT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, QUIT_EXIT_POLL_MS));
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) return;
    } catch {
      return;
    }
  }
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
          starter: starterFromHealth(data),
          healthPid: typeof data.pid === "number" ? data.pid : undefined,
          storedPid: storedSpawnedPid,
        });
        if (shouldStop) {
          try {
            const shutdownUrl = `${localApiBase(config)}/api/shutdown`;
            await fetch(shutdownUrl, userQuitShutdownInit(shutdownUrl));
            await waitForServerExit(localApiBase(config));
          } catch { /* already stopped */ }
        }
      }
    } catch { /* server not reachable — already stopped */ }
    return;
  }

  // Legacy path: use serverStartedByUs flag.
  if (!serverStartedByUs) return;
  try {
    const shutdownUrl = `${localApiBase(config)}/api/shutdown`;
    await fetch(shutdownUrl, userQuitShutdownInit(shutdownUrl));
  } catch { /* already stopped */ }
}
