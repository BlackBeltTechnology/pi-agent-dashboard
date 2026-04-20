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
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { SpawnStrategy } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { MANAGED_BIN } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
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

// ── Public API ─────────────────────────────────────────────────────────────

export interface SessionOptions {
  sessionFile?: string;
  mode?: "continue" | "fork";
  strategy?: SpawnStrategy;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
  process?: ChildProcess;
  /** True when spawned from the dashboard (for writing session meta) */
  dashboardSpawned?: boolean;
}

/** Build env with managed install bin + current node binary dir prepended to PATH. */
export function buildSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return resolver.buildSpawnEnv(baseEnv);
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

function isWslTmuxAvailable(): boolean {
  // WSL tmux probe. Route through `buildSafeArgv` so there is NO
  // cmd.exe-as-shell in the path — `spawnSync("wsl", ["which", "tmux"])`
  // with windowsHide:true + shell:false keeps the console invisible.
  // `wsl.exe` itself still spins up WSL briefly, but that's background
  // (no visible window). Only invoked after `wt` is known absent.
  try {
    const { argv, spawnOptions } = buildSafeArgv("wsl", ["which", "tmux"]);
    const r = spawnSync(argv[0], argv.slice(1), {
      stdio: "ignore",
      timeout: 1500,
      ...spawnOptions,
    });
    return r.status === 0;
  } catch {
    return false;
  }
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
    return { success: false, message: `Directory does not exist: ${cwd}` };
  }

  const mechanism = chooseMechanism(options, options?.electronMode ?? false);

  switch (mechanism) {
    case "tmux":     return spawnTmux(cwd, options);
    case "wt":       return spawnWt(cwd, options);
    case "wsl-tmux": return spawnWslTmux(cwd, options);
    case "headless": return spawnHeadless(cwd, options);
  }
}

// ── Per-mechanism spawn ────────────────────────────────────────────────────

function spawnTmux(cwd: string, options?: SessionOptions): SpawnResult {
  const exists = dashboardSessionExists();
  const cmd = buildTmuxCommand(cwd, exists, options);
  try {
    execSync(cmd, { stdio: "ignore" });
    return {
      success: true,
      dashboardSpawned: true,
      message: `Pi session spawned in tmux (${exists ? "new window" : "new session"})`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to spawn session: ${err.message}` };
  }
}

function spawnWslTmux(cwd: string, options?: SessionOptions): SpawnResult {
  try {
    const cmd = `wsl ${buildTmuxCommand(cwd, false, options)}`;
    execSync(cmd, { stdio: "ignore" });
    return { success: true, dashboardSpawned: true, message: "Pi session spawned via WSL tmux" };
  } catch (err: any) {
    return { success: false, message: `Failed to spawn via WSL tmux: ${err.message}` };
  }
}

async function spawnWt(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  const wt = resolver.which("wt");
  if (!wt) {
    return { success: false, message: "Windows Terminal (wt.exe) not found" };
  }
  const piCmd = resolvePiCommand();
  if (!piCmd) {
    return { success: false, message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }

  const piArgv = [...piCmd, ...buildInteractivePiArgs(options)];
  const args = buildWtArgs({ cwd, title: path.basename(cwd) || "pi", piArgv });

  const r = await spawnDetached({
    cmd: wt,
    args,
    cwd,
    env: buildSpawnEnv(),
  });

  if (!r.ok) {
    return { success: false, message: `Failed to launch Windows Terminal: ${r.error}` };
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
  const args = buildHeadlessArgs(options);
  const env = buildSpawnEnv();
  const piCmd = resolvePiCommand();
  if (!piCmd) {
    return { success: false, message: `pi binary not found. Checked: ${MANAGED_BIN} and system PATH.` };
  }
  const [bin, ...prefixArgs] = piCmd;

  const platform = process.platform;
  if (platform === "win32") {
    return spawnHeadlessDetached(cwd, bin, prefixArgs, args, env);
  }

  // Unix: use the sh -c "tail -f /dev/null | pi" wrapper so pi's stdin is
  // an internal pipe that survives GC. Pass through the detached-spawn
  // primitive so all the libuv defaults (detached, stdio, windowsHide) are
  // uniform. The wrapper is a domain-specific stdin-survival trick — it
  // belongs here (process-manager), not inside the primitive.
  const piLine = [shellEscape(bin), ...[...prefixArgs, ...args].map(shellEscape)].join(" ");
  const r = await spawnDetached({
    cmd: "sh",
    args: ["-c", `tail -f /dev/null | ${piLine}`],
    cwd,
    env,
  });
  if (!r.ok) {
    return { success: false, message: `Failed to spawn headless (Unix): ${r.error}` };
  }
  return {
    success: true,
    dashboardSpawned: true,
    message: `Pi session spawned headless (pid ${r.pid})`,
    pid: r.pid,
    process: r.process,
  };
}

/**
 * Windows headless spawn using the detached-spawn primitive.
 *
 * Key correctness fixes vs. the previous spawnHeadlessWindows:
 *   • detached: true            (via primitive) — excludes from libuv's
 *                                kill-on-close job; sessions survive
 *                                server restart.
 *   • shell: false              (via primitive) — sidesteps Node issue
 *                                #21825 and cmd.exe /d /s /c edge cases.
 *                                Requires pi to be [node.exe, cli.js],
 *                                NOT pi.cmd. If only pi.cmd is on PATH,
 *                                we surface an actionable error.
 *   • stdio[0] = "ignore"       — no parent-owned stdin pipe.
 *   • stdio[2] = logFd          — stderr to a persisted log file (not
 *                                a pipe that dies with the parent).
 *   • Crash window 300 ms       (was 1500 ms) — via waitForNoCrash.
 */
async function spawnHeadlessDetached(
  cwd: string,
  bin: string,
  prefixArgs: string[],
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  // Refuse to go through cmd.exe — the managed install must be present
  // so resolvePiCommand returned [node.exe, cli.js]. If someone has
  // only pi.cmd on PATH, point them at the wizard / managed install.
  if (bin.toLowerCase().endsWith(".cmd") || bin.toLowerCase().endsWith(".bat")) {
    return {
      success: false,
      message:
        "Windows pi spawn requires node.exe + cli.js (managed install). " +
        "Found only pi.cmd on PATH. Run the dashboard setup wizard or " +
        "install pi via the dashboard's Packages view.",
    };
  }

  // Prepare a per-session log file for stderr capture.
  const logDir = path.join(os.homedir(), ".pi", "dashboard", "sessions");
  try { mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  const logPath = path.join(logDir, `pi-spawn-${Date.now()}-${Math.floor(Math.random() * 1e6)}.log`);

  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
  } catch {
    // If we can't open the log, proceed without stderr capture; still spawn.
    logFd = undefined;
  }

  const cmdForLog = `${bin} ${[...prefixArgs, ...args].join(" ")}`;
  console.error(`[spawn] Windows headless (detached): ${cmdForLog} (cwd=${cwd}, log=${logPath})`);

  // CRITICAL: pi's `--mode rpc` listens for `process.stdin.on("end")`
  // and calls shutdown() on EOF. With `stdio[0] = "ignore"`, stdin
  // closes immediately and pi exits before resume completes. Use a
  // parent-held pipe so pi's stdin stays open as long as the dashboard
  // server is alive.
  //
  // Trade-off: when the dashboard server process dies, Windows closes
  // the pipe handle, pi sees EOF, and shuts down. This is the opposite
  // of the Unix `sh -c "tail -f /dev/null | pi"` wrapper (which keeps
  // stdin open via an internal process-group pipe that survives
  // parent death). On Windows we accept "pi dies with dashboard" as
  // the cost of RPC mode working reliably. A future keeper-process
  // approach could restore the durability invariant.
  //
  // detach: false — restores the behaviour of commit d331850 that was
  // silently overridden by 5ab7956's universal `detached: true` invariant.
  // On Windows, `detached: true` allocates a new console for the child
  // unless all stdio slots are "ignore" (libuv `src/win/process.c` only
  // sets CREATE_NO_WINDOW when no slot has UV_INHERIT_FD). With `stdin:
  // "pipe"` we ALWAYS have UV_INHERIT_FD on stdio[0], so CREATE_NO_WINDOW
  // can never fire, and `windowsHide: true` only applies SW_HIDE after
  // allocation — producing brief console flashes on every session spawn.
  // `detach: false` keeps the child inside the parent's Job Object (no
  // new console needed — no flash). "pi dies with dashboard" invariant is
  // unchanged: stdin-EOF on parent death already ties them together.
  //
  // See change: prep-for-develop-merge.
  const r = await spawnDetached({
    cmd: bin,
    args: [...prefixArgs, ...args],
    cwd,
    env,
    logFd,
    stdinMode: "pipe",
    detach: false,
  });

  // We don't need the parent's copy of the log fd; the child has its own.
  if (logFd !== undefined) {
    try { closeSync(logFd); } catch { /* ignore */ }
  }

  if (!r.ok || !r.process || !r.pid) {
    return {
      success: false,
      message: `Failed to spawn pi: ${r.error ?? "unknown error"}. Command: ${cmdForLog}`,
    };
  }

  // Short crash-detection window so we return fast on the happy path
  // but still catch immediate crashes (missing modules, config errors).
  const gate = await waitForNoCrash({ child: r.process, windowMs: 300 });
  if (!gate.ok) {
    return {
      success: false,
      message:
        `Pi process exited immediately (code ${gate.exitCode}). ` +
        `See ${logPath} for details.\nCommand: ${cmdForLog}`,
    };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: `Pi session spawned headless (pid ${r.pid})`,
    pid: r.pid,
    process: r.process,
  };
}
