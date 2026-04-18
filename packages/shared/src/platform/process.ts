/**
 * Cross-platform process primitives: port cleanup, kill, liveness, group-kill.
 *
 * Every OS-dependent helper takes an optional `platform` parameter
 * (defaulting to `process.platform`) so tests can exercise both branches
 * without mutating the global `process.platform`. See change:
 * consolidate-platform-handlers.
 */

import { execSync } from "node:child_process";

export type ExecFn = (cmd: string, opts: { encoding: "utf-8" }) => string;
export type KillFn = (pid: number, signal: NodeJS.Signals | number) => void;

export interface ProcessOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override execSync (for tests). */
  exec?: ExecFn;
  /** Override process.kill (for tests). */
  kill?: KillFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8" }): string {
  return execSync(cmd, opts) as unknown as string;
}

function defaultKill(pid: number, signal: NodeJS.Signals | number): void {
  process.kill(pid, signal);
}

// ── Port-holder detection ────────────────────────────────────────────────────

/**
 * Parse `netstat -ano -p tcp` output for PIDs listening on a port (Windows).
 * Pure function, exported for testing.
 *
 * Example input line:
 *   "  TCP    0.0.0.0:8000   0.0.0.0:0   LISTENING   12345"
 */
export function parseNetstatListeners(output: string, port: number, selfPid: number): number[] {
  const pids: number[] = [];
  const portSuffix = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^\s*TCP/i.test(line)) continue;
    if (!/LISTENING/i.test(line)) continue;
    const cols = trimmed.split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[1];
    if (!local.endsWith(portSuffix)) continue;
    const pid = Number.parseInt(cols[cols.length - 1], 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== selfPid) pids.push(pid);
  }
  return pids;
}

/**
 * Find PIDs holding a TCP port. Cross-platform:
 *   - win32: `netstat -ano -p tcp` → parse LISTENING rows
 *   - unix:  `lsof -t -i :<port> -sTCP:LISTEN`
 *
 * Best-effort: any failure returns []. Excludes the current process PID.
 */
export function findPortHolders(port: number, opts: ProcessOpts = {}): number[] {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "win32") {
      const output = exec("netstat -ano -p tcp", { encoding: "utf-8" });
      return parseNetstatListeners(String(output), port, process.pid);
    }
    const output = exec(`lsof -t -i :${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf-8" });
    return String(output).trim().split("\n").map(Number).filter((n) => n > 0 && n !== process.pid);
  } catch {
    return [];
  }
}

// ── Liveness ─────────────────────────────────────────────────────────────────

/**
 * Check whether a PID is alive. Cross-platform via `process.kill(pid, 0)`.
 */
export function isProcessAlive(pid: number, opts: { kill?: KillFn } = {}): boolean {
  const kill = opts.kill ?? defaultKill;
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Termination ──────────────────────────────────────────────────────────────

export interface KillProcessResult {
  ok: boolean;
  forced: boolean;
}

/**
 * Terminate a process, cross-platform:
 *   - win32: `taskkill /F /T /PID <pid>` (tree kill, immediate)
 *   - unix:  SIGTERM → wait up to `timeoutMs` → SIGKILL if still alive
 *
 * Returns `{ ok, forced }`. `ok` is true if the process was terminated (or
 * was already dead); `forced` is true if SIGKILL was needed on Unix.
 */
export async function killProcess(
  pid: number,
  opts: ProcessOpts & { timeoutMs?: number } = {},
): Promise<KillProcessResult> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  const kill = opts.kill ?? defaultKill;
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (!isProcessAlive(pid, { kill })) return { ok: false, forced: false };

  if (platform === "win32") {
    try {
      exec(`taskkill /F /T /PID ${pid}`, { encoding: "utf-8" });
      return { ok: true, forced: false };
    } catch {
      return { ok: false, forced: false };
    }
  }

  try {
    kill(pid, "SIGTERM");
  } catch {
    return { ok: false, forced: false };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isProcessAlive(pid, { kill })) return { ok: true, forced: false };
  }
  try {
    kill(pid, "SIGKILL");
  } catch {
    /* already dead */
  }
  return { ok: true, forced: true };
}

// ── Process-group kill (for detached children) ───────────────────────────────

/**
 * Signal a process, targeting the process group on Unix (negative PID) and
 * the PID directly on Windows. Used for detached children spawned with their
 * own process group.
 */
export function killPidWithGroup(
  pid: number,
  signal: NodeJS.Signals,
  opts: ProcessOpts = {},
): void {
  const platform = opts.platform ?? process.platform;
  const kill = opts.kill ?? defaultKill;
  const target = platform === "win32" ? pid : -pid;
  kill(target, signal);
}
