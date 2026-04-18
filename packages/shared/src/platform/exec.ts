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
