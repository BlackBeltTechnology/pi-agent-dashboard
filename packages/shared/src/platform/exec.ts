/**
 * Safe child-process wrappers that always set `windowsHide: true`.
 *
 * Rationale
 * ─────────
 * On Windows, spawning a `.cmd` shim (or anything node.exe wraps via cmd.exe)
 * flashes a cmd-prompt window unless `windowsHide: true` is passed. This is
 * a universal source of visible-UI bugs in this project: bridge process
 * scanners, git polls, openspec polls, terminal subprocess checks, etc.
 * Every spawn site needed to remember to set the flag, and we kept missing
 * some (session-diff, git-operations, update-checker, doctor, tunnel, ...).
 *
 * Rather than fixing this per call site forever, this module wraps the
 * Node `child_process` API with `windowsHide: true` as the default. Callers
 * can still override by explicitly passing `windowsHide: false` if they
 * genuinely want a visible console (none of our callers do).
 *
 * **Every spawn in packages/*\/src SHOULD import from here** instead of
 * directly from `node:child_process`. A repo-level check can fail if
 * direct imports sneak back in. See change: consolidate-platform-handlers.
 */
import {
  execSync as nodeExecSync,
  exec as nodeExec,
  execFile as nodeExecFile,
  spawnSync as nodeSpawnSync,
  spawn as nodeSpawn,
  type ExecSyncOptions,
  type ExecOptions,
  type ExecFileOptions,
  type SpawnSyncOptions,
  type SpawnOptions,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import { promisify } from "node:util";

// ── Argv safety (Windows .cmd / .bat handling) ─────────────────────────────

/**
 * Build a spawn-safe argv for ANY command on ANY platform.
 *
 * The canonical way to invoke subprocesses without flashing cmd.exe
 * console windows on Windows. Handles three cases:
 *
 *   1. Windows + `.cmd` / `.bat` shim → explicit `cmd.exe /c <cmd> <args>`.
 *      This is the ONLY reliable way to invoke `.cmd` files without the
 *      flashing-console bug (Node issue #21825, which happens when
 *      `shell: true` is combined with `.cmd` + `detached` + `windowsHide`).
 *      cmd.exe respects `windowsHide: true` on its own console directly.
 *
 *   2. Windows + native binary (`.exe`) → direct argv.
 *
 *   3. Unix (any binary or shell script) → direct argv.
 *
 * Always returns `{ shell: false, windowsHide: true }` — NEVER uses
 * `shell: true`. Callers pass these spawn options along with the argv.
 *
 * Example:
 *   const { argv, spawnOptions } = buildSafeArgv("npm.cmd", ["root", "-g"]);
 *   spawnSync(argv[0], argv.slice(1), { cwd, env, ...spawnOptions });
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
export interface SafeArgv {
  argv: string[];
  spawnOptions: { shell: false; windowsHide: true };
}

export function buildSafeArgv(
  cmd: string,
  args: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): SafeArgv {
  if (platform === "win32") {
    // Route through cmd.exe for TWO cases:
    //   1. Explicit .cmd/.bat shim — Node can't spawn these directly
    //      with shell:false (CVE-2024-27980 fix in Node >= 20.12).
    //   2. Extensionless name (e.g. "npm", "pi", "git") — Windows
    //      resolves these via PATHEXT, but only shells do. Without
    //      cmd.exe, spawn("npm") returns ENOENT because there's no
    //      literal "npm" binary — just "npm.cmd".
    // Native .exe / absolute paths bypass cmd.exe (no PATHEXT needed).
    //
    // /d = skip AutoRun, /s = treat quoted first token as command
    // (preserves spaces), /c = run and exit. cmd.exe honors
    // windowsHide on its console, so inner .cmd's node.exe inherits an
    // invisible console — no flash.
    const isShim = /\.(cmd|bat)$/i.test(cmd);
    const hasExtension = /\.[A-Za-z0-9]+$/.test(cmd);
    if (isShim || !hasExtension) {
      return {
        argv: ["cmd.exe", "/d", "/s", "/c", cmd, ...args],
        spawnOptions: { shell: false, windowsHide: true },
      };
    }
  }
  return {
    argv: [cmd, ...args],
    spawnOptions: { shell: false, windowsHide: true },
  };
}

// ── Option helpers ──────────────────────────────────────────────────────────

type AnyOptions = { windowsHide?: boolean } | undefined;

/**
 * Merge caller options with `windowsHide: true` as the default.
 * Explicit `windowsHide: false` from the caller is honored (for the rare
 * case where a visible console is actually desired).
 */
function withHide<T extends AnyOptions>(opts: T): T & { windowsHide: boolean } {
  const hide = opts?.windowsHide ?? true;
  return { ...(opts ?? {}), windowsHide: hide } as T & { windowsHide: boolean };
}

// ── Synchronous wrappers ────────────────────────────────────────────────────

/** Wrapped `execSync`. Always `windowsHide: true` unless overridden. */
export function execSync(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string {
  return nodeExecSync(command, withHide(options));
}

/** Wrapped `spawnSync`. Always `windowsHide: true` unless overridden. */
export function spawnSync<T extends string | Buffer = Buffer>(
  command: string,
  args?: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<T> {
  return nodeSpawnSync(command, args ?? [], withHide(options)) as SpawnSyncReturns<T>;
}

// ── Asynchronous (callback) wrappers ────────────────────────────────────────

/** Wrapped `exec` (callback form). */
export function exec(
  command: string,
  callback?: (err: Error | null, stdout: string, stderr: string) => void,
): ChildProcess;
export function exec(
  command: string,
  options: ExecOptions,
  callback?: (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
): ChildProcess;
export function exec(
  command: string,
  optionsOrCallback?: ExecOptions | ((err: Error | null, stdout: any, stderr: any) => void),
  maybeCallback?: (err: Error | null, stdout: any, stderr: any) => void,
): ChildProcess {
  if (typeof optionsOrCallback === "function") {
    return nodeExec(command, withHide(undefined) as ExecOptions, optionsOrCallback);
  }
  return nodeExec(command, withHide(optionsOrCallback) as ExecOptions, maybeCallback);
}

/** Wrapped `execFile` (callback form). */
export function execFile(
  file: string,
  args: readonly string[] | undefined,
  options: ExecFileOptions,
  callback?: (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
): ChildProcess;
export function execFile(
  file: string,
  args?: readonly string[],
  callback?: (err: Error | null, stdout: string, stderr: string) => void,
): ChildProcess;
export function execFile(
  file: string,
  args?: readonly string[],
  optionsOrCallback?: ExecFileOptions | ((err: Error | null, stdout: any, stderr: any) => void),
  maybeCallback?: (err: Error | null, stdout: any, stderr: any) => void,
): ChildProcess {
  if (typeof optionsOrCallback === "function") {
    return nodeExecFile(file, args ?? [], withHide(undefined) as ExecFileOptions, optionsOrCallback);
  }
  return nodeExecFile(file, args ?? [], withHide(optionsOrCallback) as ExecFileOptions, maybeCallback);
}

/** Wrapped `spawn`. Always `windowsHide: true` unless overridden. */
export function spawn(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  return nodeSpawn(command, args ?? [], withHide(options));
}

// ── Promise-returning variants ──────────────────────────────────────────────

/** Promise-returning exec. */
export const execAsync = promisify(exec) as (
  command: string,
  options?: ExecOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

/** Promise-returning execFile. */
export const execFileAsync = promisify(execFile) as (
  file: string,
  args?: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

// ── Types pass-through for convenience ──────────────────────────────────────

export type {
  ExecSyncOptions,
  ExecOptions,
  ExecFileOptions,
  SpawnSyncOptions,
  SpawnOptions,
  ChildProcess,
  SpawnSyncReturns,
};
