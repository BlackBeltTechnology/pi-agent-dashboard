/**
 * `launchDashboardServer` — single shared spawn primitive for the
 * dashboard server. Used by every starter (Bridge, Standalone CLI,
 * Electron). Owns:
 *
 *   - jiti loader resolution via `ToolResolver.resolveJiti({ anchor })`
 *   - argv construction via `spawnNodeScript` (which delegates to
 *     `buildNodeImportArgvParts` for the `--import` chunk)
 *   - env merge: `ToolResolver.buildSpawnEnv()` ∪ caller `env`
 *     (caller wins on conflict, e.g. `DASHBOARD_STARTER`)
 *   - log-file policy: caller-owned absolute path; we mkdir, open in
 *     append mode, write a header line, pass the fd, then close the
 *     parent's copy after spawn.
 *   - readiness policy: poll `isDashboardRunning(port)` and resolve /
 *     reject on the first of: health-ok, port-conflict, child early
 *     exit, or `healthTimeoutMs` elapsed.
 *
 * Does NOT own the log-file PATH — that's caller policy. Conventions:
 *   - extension: `stdio: "ignore"`
 *   - cli (`cmdStart`): `~/.pi/dashboard/server.log`
 *   - electron: existing electron log path
 *
 * See change: unify-server-launch-ts-loader.
 */
import { dirname } from "node:path";
import {
  closeSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import type { ChildProcess, SpawnOptions } from "node:child_process"; // ban:child_process-ok — types only
import { spawnNodeScript } from "./platform/node-spawn.js";
import { ToolResolver } from "./platform/binary-lookup.js";
import { isDashboardRunning } from "./server-identity.js";

// ── Errors ──────────────────────────────────────────────────────────────────

/** No jiti install resolved at any anchor. */
export class JitiNotFoundError extends Error {
  constructor(message =
    "Cannot find pi's TypeScript loader (jiti). " +
    "Is @earendil-works/pi-coding-agent or @mariozechner/pi-coding-agent installed?",
  ) {
    super(message);
    this.name = "JitiNotFoundError";
  }
}

/** Target port is occupied by a non-dashboard service. */
export class PortConflictError extends Error {
  readonly port: number;
  constructor(port: number) {
    super(`Port ${port} is occupied by a non-dashboard service`);
    this.name = "PortConflictError";
    this.port = port;
  }
}

/** Spawned child exited before reaching health-ok. */
export class EarlyExitError extends Error {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  constructor(code: number | null, signal: NodeJS.Signals | null = null) {
    super(`Server child exited (code=${code}, signal=${signal}) before reaching health`);
    this.name = "EarlyExitError";
    this.code = code;
    this.signal = signal;
  }
}

// ── Options + result ────────────────────────────────────────────────────────

export interface LaunchOpts {
  /** Path to node binary. Defaults to `process.execPath`. */
  nodeBin?: string;
  /** Path to the dashboard server CLI script. */
  cliPath: string;
  /** Args appended after the entry script (e.g. `--port`, `--pi-port`, `start`). */
  extraArgs?: readonly string[];
  /**
   * Node-level args inserted before `--import <loader>` (e.g.
   * `--max-old-space-size=4096`). See change: configurable max heap.
   */
  nodeArgs?: readonly string[];
  /** Caller-supplied jiti-resolution anchor (e.g. cliPath inside a node_modules tree). */
  anchor?: string;
  /**
   * Caller env overrides merged ON TOP of `ToolResolver.buildSpawnEnv()`.
   * Conflicting keys: caller wins. Pass `DASHBOARD_STARTER` here.
   * Omit to fall back to the resolver-merged process env.
   */
  env?: Record<string, string | undefined>;
  /**
   * Stdio routing. `"ignore"` for fire-and-forget (extension); a
   * `{ logFile }` object for caller-owned append-mode log capture.
   */
  stdio: "ignore" | { logFile: string };
  /**
   * Optional starter label written to the log header line and (when
   * present) injected as `DASHBOARD_STARTER` env var if `env` does not
   * already supply it. Plain string ("Bridge", "Standalone", "Electron").
   */
  starter?: string;
  /** Health-check timeout in milliseconds. */
  healthTimeoutMs: number;
  /** Port to probe via `isDashboardRunning(port)`. */
  port: number;
  /**
   * Whether the spawned server detaches from the parent's process
   * group / Windows Job Object. Default: `true` (server outlives the
   * launcher — correct for Bridge auto-spawn and Standalone CLI).
   *
   * Pass `false` when the caller deliberately ties the server's
   * lifecycle to its own (Electron — server should die when Electron
   * quits unless Electron explicitly decides to keep it).
   */
  detach?: boolean;
  /**
   * Working directory for the spawned process. Defaults to the
   * launcher's own cwd. Electron passes the project directory.
   */
  cwd?: string;
  // ── Test seams (production omits) ────────────────────────────────────────
  /** Replace `ToolResolver.resolveJiti` (returns loader URL or null). */
  _resolveJiti?: () => string | null;
  /** Replace `spawnNodeScript` (returns ChildProcess). */
  _spawnNodeScript?: typeof spawnNodeScript;
  /** Replace `isDashboardRunning`. */
  _isDashboardRunning?: typeof isDashboardRunning;
  /** Replace fs primitives used for log-file handling. */
  _fs?: {
    mkdirSync?: typeof mkdirSync;
    openSync?: typeof openSync;
    closeSync?: typeof closeSync;
    writeSync?: typeof writeSync;
  };
  /** Override poll interval (ms). Default 300. */
  _pollIntervalMs?: number;
  /** Override `Date.now` for deterministic timeout testing. */
  _now?: () => number;
  /** Override the sleep function used between polls. */
  _sleep?: (ms: number) => Promise<void>;
}

export interface LaunchResult {
  /** Spawned process pid (always present once spawn succeeded). */
  childPid: number;
  /** PID reported by `/api/health` (matches `dashboard.pid`); null if unavailable. */
  reportedPid: number | null;
  /** Always true when this resolves — readiness was confirmed. */
  healthOk: true;
}

// ── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_POLL_MS = 300;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Filter out `undefined` values from an env-record (NodeJS.ProcessEnv
 * tolerates undefined; child_process.spawn does not).
 */
function compactEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Spawn the dashboard server and wait for `/api/health` to confirm
 * identity. Resolves with `{ childPid, reportedPid, healthOk: true }`
 * on success; rejects with `JitiNotFoundError` / `PortConflictError`
 * / `EarlyExitError` / readiness-timeout `Error` per the spec.
 */
export async function launchDashboardServer(opts: LaunchOpts): Promise<LaunchResult> {
  const nodeBin = opts.nodeBin ?? process.execPath;
  const resolveJiti = opts._resolveJiti ?? (() => new ToolResolver({ processExecPath: nodeBin }).resolveJiti({ anchor: opts.anchor }));
  const spawn = opts._spawnNodeScript ?? spawnNodeScript;
  const probe = opts._isDashboardRunning ?? isDashboardRunning;
  const pollIntervalMs = opts._pollIntervalMs ?? DEFAULT_POLL_MS;
  const now = opts._now ?? Date.now;
  const sleep = opts._sleep ?? defaultSleep;
  const fsMkdir = opts._fs?.mkdirSync ?? mkdirSync;
  const fsOpen = opts._fs?.openSync ?? openSync;
  const fsClose = opts._fs?.closeSync ?? closeSync;
  const fsWrite = opts._fs?.writeSync ?? writeSync;

  // 1. Loader resolution.
  const loader = resolveJiti();
  if (!loader) throw new JitiNotFoundError();

  // 2. Env: ToolResolver.buildSpawnEnv() merged with caller env (caller wins).
  const baseEnv = new ToolResolver({ processExecPath: nodeBin }).buildSpawnEnv(process.env);
  const env: Record<string, string> = compactEnv(baseEnv);
  if (opts.starter && !(opts.env && "DASHBOARD_STARTER" in opts.env)) {
    env["DASHBOARD_STARTER"] = opts.starter;
  }
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (typeof v === "string") env[k] = v;
      else if (v === undefined) delete env[k];
    }
  }

  // 3. Stdio + log header.
  let logFd: number | undefined;
  let stdio: SpawnOptions["stdio"];
  if (opts.stdio === "ignore") {
    stdio = "ignore";
  } else {
    const { logFile } = opts.stdio;
    fsMkdir(dirname(logFile), { recursive: true });
    logFd = fsOpen(logFile, "a");
    const header = `[${new Date().toISOString()}] ${opts.starter ?? "dashboard"} launch (parent pid ${process.pid}, port ${opts.port}, cli ${opts.cliPath})\n`;
    try { fsWrite(logFd, header); } catch { /* best-effort */ }
    stdio = ["ignore", logFd, logFd];
  }

  // 4. Spawn. spawnNodeScript handles --import URL-wrapping + entry rule.
  let child: ChildProcess;
  try {
    child = spawn({
      nodeBin,
      loader,
      entry: opts.cliPath,
      args: opts.extraArgs ? [...opts.extraArgs] : undefined,
      nodeArgs: opts.nodeArgs ? [...opts.nodeArgs] : undefined,
      spawnOptions: {
        detached: opts.detach ?? true,
        stdio,
        env,
        cwd: opts.cwd,
        windowsHide: true,
      },
    });
  } finally {
    // Always close the parent's copy of the log fd; the child has its own.
    if (logFd !== undefined) {
      try { fsClose(logFd); } catch { /* ignore */ }
    }
  }

  try { child.unref(); } catch { /* ignore */ }

  if (!child.pid) {
    throw new EarlyExitError(child.exitCode ?? null, child.signalCode ?? null);
  }

  // 5. Readiness loop.
  const deadline = now() + opts.healthTimeoutMs;
  while (true) {
    // Early-exit detection (beats timeout per spec).
    if (child.exitCode !== null) {
      throw new EarlyExitError(child.exitCode, child.signalCode ?? null);
    }
    let status;
    try {
      status = await probe(opts.port);
    } catch {
      status = { running: false } as const;
    }
    if (status.running) {
      return {
        childPid: child.pid,
        reportedPid: status.pid ?? null,
        healthOk: true,
      };
    }
    if (status.portConflict) {
      throw new PortConflictError(opts.port);
    }
    if (now() >= deadline) {
      throw new Error("readiness timeout");
    }
    await sleep(pollIntervalMs);
  }
}
