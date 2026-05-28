/**
 * Process manager for spawning pi sessions.
 *
 * Dispatch is owned by `platform/spawn-mechanism.ts`'s `selectMechanism`.
 * Per-mechanism spawn is owned by `platform/detached-spawn.ts`. This
 * module's job is: resolve pi + tool availability, build per-mechanism
 * command, delegate.
 *
 * Invariants:
 *   - No direct `process.platform === "..."` branches in this file.
 *     All platform-aware behaviour lives in `platform/**`.
 *   - Every mechanism branch builds pi argv uniformly from
 *     `buildHeadlessArgs` or its wt/tmux counterpart; `sessionFile`
 *     and `mode` are never dropped by any branch.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { SpawnStrategy } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { MANAGED_BIN } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { prependManagedNodeToPath } from "@blackbelt-technology/pi-dashboard-shared/platform/managed-node-path.js";
import { mintSpawnToken } from "./spawn-token.js";
import {
  createKeeperManager,
  type KeeperManager,
} from "./rpc-keeper/keeper-manager.js";
import { randomUUID } from "node:crypto";
import { execSync, spawnSync, buildSafeArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  spawnDetached,
  waitForNoCrash,
} from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import {
  selectMechanism,
  buildWtArgs,
  sessionFlagsToArgv,
  type SpawnMechanism,
  type UserSpawnStrategy,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import type { SpawnFailureCode } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

// ── Resolver seam (injectable for tests) ────────────────────────────────────

let resolver: ToolResolver = new ToolResolver({ processExecPath: process.execPath });

/** Inject a resolver — used by tests. Production code never calls this. */
export function setResolver(r: ToolResolver): void {
  resolver = r;
}

/** Reset to default — used by tests to clean up. */
export function resetResolver(): void {
  resolver = new ToolResolver({ processExecPath: process.execPath });
}

// ── KeeperManager seam (injectable for tests) ──────────────────────────

let keeperManager: KeeperManager | null = null;

/** Inject a KeeperManager — used by tests. Production code lazy-inits below. */
export function setKeeperManager(km: KeeperManager | null): void {
  keeperManager = km;
}

/**
 * Public lazy accessor for the singleton `KeeperManager`. Exposed so the
 * server-side dispatch handler (`rpc-keeper/dispatch-router.ts`) and
 * `headlessPidRegistry.setKeeperWriter` can share the same instance the
 * spawn path uses. Tests still inject via `setKeeperManager`.
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6 + 8).
 */
export function getKeeperManager(): KeeperManager {
  if (!keeperManager) keeperManager = createKeeperManager();
  return keeperManager;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface SessionOptions {
  sessionFile?: string;
  mode?: "continue" | "fork";
  strategy?: SpawnStrategy;
  /**
   * Server-minted spawn correlation token. When provided, injected into
   * the spawned process env as `PI_DASHBOARD_SPAWN_TOKEN`. The bridge
   * echoes it back in the first `session_register` so the server can
   * resolve identity precisely (linkByToken). When omitted, callers
   * fall through to pid-link or cwd-FIFO matching.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
  process?: ChildProcess;
  /** True when spawned from the dashboard (for writing session meta) */
  dashboardSpawned?: boolean;
  /** Structured failure classifier. Set on every { success: false } path. See change: spawn-failure-diagnostics. */
  code?: SpawnFailureCode;
  /** Tail of pi's stderr log (Windows headless PI_CRASHED only). See change: spawn-failure-diagnostics. */
  stderr?: string;
  /** Path to the per-session stderr log (Windows headless). Forwarded to watchdog. See change: spawn-failure-diagnostics. */
  logPath?: string;
  /**
   * Token minted by `spawnPiSession` and injected into the spawned process's
   * env as `PI_DASHBOARD_SPAWN_TOKEN`. Returned so callers can register it
   * with the headless-pid registry, watchdog, and pending-* registries.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
  /**
   * RPC keeper UDS / named-pipe path. Set on every successful headless
   * spawn (the keeper is the only spawn mechanism for `--mode rpc`).
   * Callers pass this to `headlessPidRegistry.register(..., { keeperPid,
   * keeperSockPath })` so later `writeRpc` / `killBySessionId` calls can
   * locate the keeper. `pid` IS the keeper PID, so `keeperPid` is implicit.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar,
   * enable-rpc-keeper-by-default.
   */
  keeperSockPath?: string;
}

/**
 * Build env for pi-session spawns.
 *
 * Order of PATH prepends (highest priority first):
 *   1. Managed Node runtime (`<managedDir>/node/{bin,}`) when installed.
 *      See change: embed-managed-node-runtime.
 *   2. Managed bin (`<managedDir>/node_modules/.bin`).
 *   3. Current Node binary dir, extra bin dirs, common user bin dirs.
 *
 * The managed-Node prepend happens AFTER the resolver's prepends so it
 * lands at the very head of `PATH` — spawned children invoking plain
 * `node` / `npm` resolve to the managed runtime first.
 */
export function buildSpawnEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  opts?: { spawnToken?: string },
): NodeJS.ProcessEnv {
  const env = prependManagedNodeToPath(resolver.buildSpawnEnv(baseEnv));
  if (opts?.spawnToken) {
    // Inject the correlation token so the bridge inside the spawned pi
    // process can read it and echo back in `session_register`.
    // See change: spawn-correlation-token.
    return { ...env, PI_DASHBOARD_SPAWN_TOKEN: opts.spawnToken };
  }
  return env;
}

/**
 * Escape a string for safe use inside a POSIX shell command.
 * Used by buildTmuxCommand for tmux/wsl-tmux argv construction.
 */
export function shellEscape(s: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the argv tail for a headless pi invocation: `--mode rpc` plus
 * `--session <file>` or `--fork <file>` when options provide them.
 */
export function buildHeadlessArgs(options?: SessionOptions): string[] {
  return ["--mode", "rpc", ...sessionFlagsToArgv(options ?? {})];
}

/**
 * Build the argv tail for an INTERACTIVE pi invocation (wt, tmux, wsl-tmux):
 * no `--mode rpc`; just session/fork flags when provided.
 */
export function buildInteractivePiArgs(options?: SessionOptions): string[] {
  return sessionFlagsToArgv(options ?? {});
}

/**
 * Build a tmux shell command string to run pi in a new tmux window/session.
 * Kept as a string (not argv) because tmux is invoked via `execSync(cmd)`.
 */
export function buildTmuxCommand(cwd: string, sessionExists: boolean, options?: SessionOptions): string {
  const safeCwd = shellEscape(cwd);
  const flags = sessionFlagsToArgv(options ?? {})
    .map(shellEscape)
    .join(" ");
  const piCmd = flags ? `cd ${safeCwd} && pi ${flags}` : `cd ${safeCwd} && pi`;
  if (sessionExists) {
    return `tmux new-window -t pi-dashboard -c ${safeCwd} "${piCmd}"`;
  }
  return `tmux new-session -d -s pi-dashboard -c ${safeCwd} "${piCmd}"`;
}

// ── Availability probes (isolated, one place) ───────────────────────────────

function isTmuxAvailable(): boolean {
  try {
    // `which` / `where` already baked into ToolResolver.
    return resolver.which("tmux") !== null;
  } catch {
    return false;
  }
}

function isWtAvailable(): boolean {
  try {
    return resolver.which("wt") !== null;
  } catch {
    return false;
  }
}

// Cache the WSL-tmux probe for the server lifetime. On machines with a broken
// WSL install (e.g. Docker Desktop WSL mount failure) this single probe can
// cost 30+ seconds — we MUST NOT pay it on every + Session click. The result
// can only change if the user installs/uninstalls WSL or tmux, which requires
// a server restart anyway.
let _wslTmuxAvailabilityCache: boolean | null = null;
let _wslFallbackLogged = false;

/** Test-only: reset the cache so tests can exercise both branches. */
export function _resetWslTmuxCacheForTests(): void {
  _wslTmuxAvailabilityCache = null;
  _wslFallbackLogged = false;
}

function isWslTmuxAvailable(): boolean {
  // WSL tmux probe. Route through `buildSafeArgv` so there is NO
  // cmd.exe-as-shell in the path — `spawnSync("wsl", ["which", "tmux"])`
  // with windowsHide:true + shell:false keeps the console invisible.
  // `wsl.exe` itself still spins up WSL briefly, but that's background
  // (no visible window). Only invoked after `wt` is known absent.
  //
  // Cached for the server lifetime (see comment on _wslTmuxAvailabilityCache).
  if (_wslTmuxAvailabilityCache !== null) return _wslTmuxAvailabilityCache;
  try {
    const { argv, spawnOptions } = buildSafeArgv("wsl", ["which", "tmux"]);
    const r = spawnSync(argv[0], argv.slice(1), {
      stdio: "ignore",
      timeout: 1500,
      ...spawnOptions,
    });
    _wslTmuxAvailabilityCache = r.status === 0;
  } catch {
    _wslTmuxAvailabilityCache = false;
  }
  if (!_wslTmuxAvailabilityCache && !_wslFallbackLogged) {
    _wslFallbackLogged = true;
    console.error(
      "[spawn] Windows Terminal (wt.exe) not on PATH and WSL tmux unavailable \u2014 " +
      "falling back to headless session spawn. Install Windows Terminal for a " +
      "nicer UX: https://aka.ms/terminal",
    );
  }
  return _wslTmuxAvailabilityCache;
}

function dashboardSessionExists(): boolean {
  try {
    execSync("tmux has-session -t pi-dashboard 2>/dev/null", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Resolve pi as argv. Prefers node.exe + cli.js on Windows (avoids .cmd). */
function resolvePiCommand(): string[] | null {
  return resolver.resolvePi();
}

// ── Mechanism dispatch ─────────────────────────────────────────────────────

/**
 * Select the spawn mechanism for this invocation using lazy tool
 * availability probing. Each probe runs a subprocess, so we short-
 * circuit as soon as a mechanism is decided — crucially, the WSL
 * probe (`wsl which tmux`) spins up the WSL VM on Windows and is
 * the most expensive, so we only run it when wt is ALREADY known
 * absent and the user hasn't asked for headless.
 *
 * Ordering mirrors `selectMechanism`'s decision rules:
 *   1. electronMode or userStrategy=headless → no probes at all
 *   2. Unix → probe tmux only
 *   3. Windows → probe wt first; probe wsl-tmux only if wt is absent
 */
function chooseMechanism(options?: SessionOptions, electronMode = false): SpawnMechanism {
  const userStrategy: UserSpawnStrategy = options?.strategy === "headless" ? "headless" : "tmux";
  const platform = process.platform;

  // Short-circuit #1: headless requires no probes.
  if (electronMode || userStrategy === "headless") {
    return "headless";
  }

  // Unix: tmux or headless.
  if (platform === "linux" || platform === "darwin") {
    return selectMechanism({
      platform,
      userStrategy,
      electronMode,
      available: { tmux: isTmuxAvailable(), wt: false, wslTmux: false },
    });
  }

  // Windows: wt first (cheap `where wt`). Only probe WSL when wt is
  // absent — `wsl which tmux` starts the WSL VM and is slow + flashy.
  if (platform === "win32") {
    const wt = isWtAvailable();
    if (wt) {
      return selectMechanism({
        platform,
        userStrategy,
        electronMode,
        available: { tmux: false, wt: true, wslTmux: false },
      });
    }
    const wslTmux = isWslTmuxAvailable();
    return selectMechanism({
      platform,
      userStrategy,
      electronMode,
      available: { tmux: false, wt: false, wslTmux },
    });
  }

  // Unknown platform → headless.
  return "headless";
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function spawnPiSession(
  cwd: string,
  options?: SessionOptions & { electronMode?: boolean },
): Promise<SpawnResult> {
  if (!existsSync(cwd)) {
    return { success: false, code: "DIR_MISSING", message: `Directory does not exist: ${cwd}` };
  }

  // Mint a spawn token if the caller didn't provide one. Token is injected
  // into the spawned process's env (via buildSpawnEnv) and surfaced on
  // SpawnResult so callers can register it with the registries.
  // See change: spawn-correlation-token.
  const spawnToken = options?.spawnToken ?? mintSpawnToken();
  const opts: SessionOptions & { electronMode?: boolean } = { ...(options ?? {}), spawnToken };

  const mechanism = chooseMechanism(opts, opts?.electronMode ?? false);

  let result: SpawnResult;
  switch (mechanism) {
    case "tmux":     result = spawnTmux(cwd, opts); break;
    case "wt":       result = await spawnWt(cwd, opts); break;
    case "wsl-tmux": result = spawnWslTmux(cwd, opts); break;
    case "headless": result = await spawnHeadless(cwd, opts); break;
  }
  // Surface the token on every result (success or failure) so callers
  // can clean up registries deterministically.
  return { ...result, spawnToken };
}

// ── Per-mechanism spawn ────────────────────────────────────────────────────

function spawnTmux(cwd: string, options?: SessionOptions): SpawnResult {
  const exists = dashboardSessionExists();
  const cmd = buildTmuxCommand(cwd, exists, options);
  // Pass env explicitly so PI_DASHBOARD_SPAWN_TOKEN reaches the tmux pane's
  // pi process (tmux inherits the caller's env into new windows/sessions).
  // See change: spawn-correlation-token.
  const env = buildSpawnEnv(process.env, { spawnToken: options?.spawnToken });
  try {
    execSync(cmd, { stdio: "ignore", env });
    return {
      success: true,
      dashboardSpawned: true,
      message: `Pi session spawned in tmux (${exists ? "new window" : "new session"})`,
    };
  } catch (err: any) {
    return { success: false, code: "TMUX_MISSING", message: `Failed to spawn session: ${err.message}` };
  }
}

function spawnWslTmux(cwd: string, options?: SessionOptions): SpawnResult {
  try {
    const cmd = `wsl ${buildTmuxCommand(cwd, false, options)}`;
    const env = buildSpawnEnv(process.env, { spawnToken: options?.spawnToken });
    execSync(cmd, { stdio: "ignore", env });
    return { success: true, dashboardSpawned: true, message: "Pi session spawned via WSL tmux" };
  } catch (err: any) {
    return { success: false, code: "TMUX_MISSING", message: `Failed to spawn via WSL tmux (wsl-tmux mechanism): ${err.message}` };
  }
}

async function spawnWt(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  const wt = resolver.which("wt");
  if (!wt) {
    return { success: false, code: "WT_MISSING", message: "Windows Terminal (wt.exe) not found" };
  }
  const piCmd = resolvePiCommand();
  if (!piCmd) {
    return { success: false, code: "PI_NOT_FOUND", message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }

  const piArgv = [...piCmd, ...buildInteractivePiArgs(options)];
  const args = buildWtArgs({ cwd, title: path.basename(cwd) || "pi", piArgv });

  const r = await spawnDetached({
    cmd: wt,
    args,
    cwd,
    env: buildSpawnEnv(process.env, { spawnToken: options?.spawnToken }),
  });

  if (!r.ok) {
    return { success: false, code: "SPAWN_ERRNO", message: `Failed to launch Windows Terminal: ${r.error}` };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: "Pi session spawned in Windows Terminal",
    pid: r.pid,
    process: r.process,
  };
}

async function spawnHeadless(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  // Headless `--mode rpc` sessions are spawned through the RPC keeper sidecar
  // on every platform. The keeper owns pi's stdin pipe (so pi survives
  // dashboard server restarts) and exposes a per-session UDS / named pipe
  // the server writes RPC `prompt` lines to (so typed extension slash commands
  // like `/ctx-stats` dispatch in headless sessions).
  // See change: add-rpc-stdin-dispatch-with-keeper-sidecar (introduced keeper),
  //             enable-rpc-keeper-by-default (made keeper the only path).
  const args = buildHeadlessArgs(options);
  const env = buildSpawnEnv(process.env, { spawnToken: options?.spawnToken });
  const piCmd = resolvePiCommand();
  if (!piCmd) {
    return { success: false, code: "PI_NOT_FOUND", message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }
  return spawnHeadlessViaKeeper(cwd, env, args, piCmd);
}

/**
 * RPC keeper sidecar headless spawn. Uniform across Unix + Windows.
 *
 * The keeper itself is a CJS-pure Node script (`rpc-keeper/keeper.cjs`).
 * It binds a per-session UDS / named pipe BEFORE spawning pi, then owns
 * pi's stdin pipe so it survives dashboard server restarts.
 *
 * Returned `pid` is the KEEPER PID (not pi's). Pi's PID is linked later
 * via the existing `session_register` token correlation path.
 *
 * Crash-detection window applies to KEEPER spawn only — the keeper itself
 * runs a separate 300 ms window on its pi child internally (and surfaces
 * the failure by exiting non-zero, which will be picked up by
 * `headless-pid-registry`'s PID-death tracking).
 *
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 5).
 */
async function spawnHeadlessViaKeeper(
  cwd: string,
  env: NodeJS.ProcessEnv,
  piArgs: string[],
  piCmd: string[],
): Promise<SpawnResult> {
  // sessionId is what the keeper uses to derive its UDS / named-pipe path.
  // This is a TRANSPORT-side identifier, distinct from pi's session UUID
  // (which only exists once pi's RPC mode boots). We mint a fresh one per
  // spawn so the keeper's socket path is unique.
  const transportId = randomUUID();

  // piArgs already includes `--mode rpc` plus any per-spawn flags from
  // `buildHeadlessArgs(options)` (e.g. `--session-file <path>` for resume,
  // `--fork` for fork). Forwarding them through the keeper preserves the
  // existing resume / fork contract. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
  //
  // piCmd is the ToolRegistry-resolved absolute argv for pi (e.g.
  // ["/abs/path/pi"] on Unix or ["node","/abs/path/cli.js"] on Windows).
  // The keeper consumes it via env var `PI_KEEPER_PI_CMD` and spawns pi
  // without relying on its own PATH. See change: fix-rpc-keeper-pi-resolution.
  const km = getKeeperManager();
  const result = await km.spawnKeeperFor(transportId, cwd, env, piArgs, piCmd);
  if (!result.success || !result.pid || !result.process) {
    return {
      success: false,
      code: "SPAWN_ERRNO",
      message: `Failed to spawn RPC keeper: ${result.error ?? "unknown error"}`,
    };
  }

  // Crash-detection window on the keeper process itself. Keeper applies
  // its own 300 ms window to pi internally; this catches keeper-side
  // failures (bind failure, pi-spawn-error, etc.) that exit the keeper
  // within the window.
  const gate = await waitForNoCrash({ child: result.process, windowMs: 300 });
  if (!gate.ok) {
    return {
      success: false,
      code: "PI_CRASHED",
      message:
        `RPC keeper exited within crash window (code ${gate.exitCode}). ` +
        `Check ~/.pi/dashboard/sessions/keeper-${transportId}.log for details.`,
    };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: `Pi session spawned via RPC keeper (keeper pid ${result.pid}, transport ${transportId.slice(0, 8)})`,
    pid: result.pid,
    process: result.process,
    keeperSockPath: result.sockPath,
    // spawnToken propagated by the outer wrapper; keeper-spawn doesn't
    // mint its own. The token already lives in `env.PI_DASHBOARD_SPAWN_TOKEN`.
  };
}

// Legacy `spawnHeadlessDetached` (Windows direct-stdin pipe) and
// `readLogTail` removed 2026-05-28 by change `enable-rpc-keeper-by-default`.
// All headless `--mode rpc` spawns now go through `spawnHeadlessViaKeeper`,
// which owns pi's stdin via the per-session keeper sidecar and survives
// dashboard server restarts uniformly across Unix and Windows.
