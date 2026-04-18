/**
 * Process manager for spawning pi sessions via tmux or headless (RPC mode).
 */
import { execSync, spawn, type ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SpawnStrategy } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { MANAGED_BIN } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

/** Server-side resolver — knows the current process node binary. */
const resolver = new ToolResolver({ processExecPath: process.execPath });

/** Build env with managed install bin + current node binary dir prepended to PATH.
 *  Delegates to ToolResolver.buildSpawnEnv().
 */
export function buildSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return resolver.buildSpawnEnv(baseEnv);
}

export interface PlatformInfo {
  strategy: "tmux" | "wsl" | "cmd";
  platform: string;
}

export function detectPlatform(platform?: string): PlatformInfo {
  const p = platform ?? process.platform;

  if (p === "darwin" || p === "linux") {
    return { strategy: "tmux", platform: p };
  }
  if (p === "win32") {
    return { strategy: "wsl", platform: p };
  }
  return { strategy: "tmux", platform: p };
}

export interface SessionOptions {
  sessionFile?: string;
  mode?: "continue" | "fork";
  strategy?: SpawnStrategy;
}

export function buildTmuxCommand(cwd: string, sessionExists: boolean, options?: SessionOptions): string {
  const safeCwd = shellEscape(cwd);
  let piCmd = `cd ${safeCwd} && pi`;

  if (options?.sessionFile && options?.mode === "continue") {
    piCmd = `cd ${safeCwd} && pi --session ${shellEscape(options.sessionFile)}`;
  } else if (options?.sessionFile && options?.mode === "fork") {
    piCmd = `cd ${safeCwd} && pi --fork ${shellEscape(options.sessionFile)}`;
  }

  if (sessionExists) {
    return `tmux new-window -t pi-dashboard -c ${safeCwd} "${piCmd}"`;
  }
  return `tmux new-session -d -s pi-dashboard -c ${safeCwd} "${piCmd}"`;
}

function isTmuxAvailable(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" });
    return true;
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

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
  process?: ChildProcess;
  /** True when spawned from the dashboard (for writing session meta) */
  dashboardSpawned?: boolean;
}

export function buildHeadlessArgs(options?: SessionOptions): string[] {
  const args = ["--mode", "rpc"];

  if (options?.sessionFile && options?.mode === "continue") {
    args.push("--session", options.sessionFile);
  } else if (options?.sessionFile && options?.mode === "fork") {
    args.push("--fork", options.sessionFile);
  }

  return args;
}

/** Resolve the pi command as [command, ...prefixArgs].
 *  Delegates to ToolResolver.resolvePi().
 */
function resolvePiCommand(): string[] | null {
  return resolver.resolvePi();
}

/** Windows-specific headless spawn with error detection and stderr capture.
 *  Waits briefly to detect immediate process death (e.g., missing deps, config errors).
 */
async function spawnHeadlessWindows(
  cwd: string,
  piCmd: string[],
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  const [bin, ...prefixArgs] = piCmd;
  const needsShell = bin.endsWith(".cmd");
  const spawnBin = needsShell ? `"${bin}"` : bin;
  const spawnArgs = needsShell
    ? [...prefixArgs, ...args].map(a => `"${a}"`)
    : [...prefixArgs, ...args];

  const cmdForLog = `${bin} ${[...prefixArgs, ...args].join(" ")}`;
  console.error(`[spawn] Windows headless: ${cmdForLog} (cwd=${cwd})`);

  // Capture stderr for diagnostics (pi might log errors there)
  const child = spawn(spawnBin, spawnArgs, {
    cwd,
    detached: false,
    stdio: ["pipe", "ignore", "pipe"],
    env,
    shell: needsShell,
    windowsHide: true,
  });

  // Collect stderr for early crash diagnostics
  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    // Limit memory: keep only last 4 KB
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  // Handle async spawn errors (e.g., ENOENT if binary disappears between check and exec)
  let spawnError: string | null = null;
  child.on("error", (err: Error) => {
    spawnError = err.message;
    console.error(`[spawn] Windows spawn error: ${err.message}`);
  });

  child.unref();
  (child.stdin as any)?.unref();
  (child.stderr as any)?.unref();

  // Guard: if pid is undefined, spawn failed synchronously
  if (!child.pid) {
    // Wait briefly for the async error event
    await new Promise(r => setTimeout(r, 200));
    return {
      success: false,
      message: `Failed to spawn pi: ${spawnError || "unknown error (no PID)"}. Command: ${cmdForLog}`,
    };
  }

  // Wait briefly to detect immediate crash (e.g., missing module, config error)
  const exitCode = await Promise.race([
    new Promise<number | null>(resolve => child.on("exit", resolve)),
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1500)),
  ]);

  if (exitCode !== undefined) {
    const detail = stderrBuf.trim()
      ? `\nstderr: ${stderrBuf.trim().split("\n").slice(-5).join("\n")}`
      : "";
    console.error(`[spawn] Pi exited immediately with code ${exitCode}${detail}`);
    return {
      success: false,
      message: `Pi process exited immediately (code ${exitCode}).${detail}\nCommand: ${cmdForLog}`,
    };
  }

  return {
    success: true,
    dashboardSpawned: true,
    message: `Pi session spawned headless (pid ${child.pid})`,
    pid: child.pid,
    process: child,
  };
}

async function spawnHeadless(cwd: string, options?: SessionOptions): Promise<SpawnResult> {
  try {
    const args = buildHeadlessArgs(options);
    const env = buildSpawnEnv();

    // Pre-check: verify pi binary exists
    const piCmd_ = resolvePiCommand();
    if (!piCmd_) {
      return {
        success: false,
        message: `pi binary not found. Checked: ${MANAGED_BIN}/pi and system PATH.`,
      };
    }

    if (process.platform === "win32") {
      return await spawnHeadlessWindows(cwd, piCmd_, args, env);
    }

    // Unix (macOS / Linux / WSL): wrap with "tail -f /dev/null | pi" so stdin
    // is an internal pipe that survives GC and server restarts.
    // detached: true creates a new process group; we kill via -pid later.
    const piBin = piCmd_[0];
    const piCmd = [shellEscape(piBin), ...args.map(shellEscape)].join(" ");
    // Use "tail -f /dev/null" to keep stdin pipe open for pi.
    // Unlike "sleep N", tail -f /dev/null works correctly even when
    // the outer shell's stdin is /dev/null (stdio:"ignore"),
    // which breaks "sleep | pi" on some Linux systems.
    const child = spawn("sh", ["-c", `tail -f /dev/null | ${piCmd}`], {
      cwd,
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();

    return {
      success: true,
      dashboardSpawned: true,
      message: `Pi session spawned headless (pid ${child.pid})`,
      pid: child.pid,
      process: child,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to spawn headless session: ${err.message}`,
    };
  }
}

/** Escape a string for safe use in a shell command. */
export function shellEscape(s: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function spawnPiSession(cwd: string, options?: SessionOptions & { electronMode?: boolean }): Promise<SpawnResult> {
  if (!existsSync(cwd)) {
    return {
      success: false,
      message: `Directory does not exist: ${cwd}`,
    };
  }

  // Electron mode always forces headless, skipping tmux detection entirely
  if (options?.electronMode || options?.strategy === "headless") {
    return spawnHeadless(cwd, options);
  }

  const platform = detectPlatform();

  if (platform.strategy === "tmux") {
    if (!isTmuxAvailable()) {
      return {
        success: false,
        message: "tmux is not installed. Install it to spawn sessions from the dashboard.",
      };
    }

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
      return {
        success: false,
        message: `Failed to spawn session: ${err.message}`,
      };
    }
  }

  if (platform.strategy === "wsl") {
    try {
      // Try WSL tmux first
      execSync("wsl which tmux", { stdio: "ignore" });
      const cmd = `wsl ${buildTmuxCommand(cwd, false)}`;
      execSync(cmd, { stdio: "ignore" });
      return { success: true, dashboardSpawned: true, message: "Pi session spawned via WSL tmux" };
    } catch {
      // Fallback to cmd
      try {
        spawn("cmd", ["/c", `cd /d "${cwd}" && pi`], {
          detached: true,
          stdio: "ignore",
        }).unref();
        return { success: true, dashboardSpawned: true, message: "Pi session spawned via cmd" };
      } catch (err: any) {
        return { success: false, message: `Failed to spawn: ${err.message}` };
      }
    }
  }

  return { success: false, message: "Unsupported platform" };
}
