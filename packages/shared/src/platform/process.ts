/**
 * Cross-platform process primitives: port cleanup, kill, liveness, group-kill.
 *
 * Every OS-dependent helper takes an optional `platform` parameter
 * (defaulting to `process.platform`) so tests can exercise both branches
 * without mutating the global `process.platform`. See change:
 * consolidate-platform-handlers.
 */

import fs from "node:fs";
import { execSync } from "./exec.js";

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
  // Always suppress the cmd.exe window flash on Windows. The primitives that
  // use this (findPortHolders via netstat, killProcess via taskkill) don't
  // need user visibility.
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
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

// ── Process start time ───────────────────────────────────────────────────────

/** Linux `USER_HZ`: clock ticks per second in `/proc/<pid>/stat` field 22. */
const USER_HZ = 100;

interface ProcessStartedAtOpts extends ProcessOpts {
  /** Override file reads (for tests). */
  readFile?: (path: string) => string;
}

/**
 * Parse `/proc/<pid>/stat` + `/proc/stat` into an epoch-ms start time.
 * Field 22 (starttime) counts ticks since boot; the comm field (2) may hold
 * spaces and parens, so fields are counted from the LAST `)`. Pure, exported
 * for testing. Returns null when either input is malformed.
 */
function parseProcStartMs(stat: string, procStat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  // After `) ` the next token is field 3 (state), so field 22 is index 19.
  const ticks = Number(stat.slice(close + 1).trim().split(/\s+/)[19]);
  const btime = Number(/^btime\s+(\d+)/m.exec(procStat)?.[1]);
  if (!Number.isFinite(ticks) || !Number.isFinite(btime)) return null;
  return btime * 1000 + Math.round((ticks / USER_HZ) * 1000);
}

/**
 * Epoch-ms start time of `pid`, or null when it cannot be determined.
 *
 * Linux reads `/proc` (the docker image ships no `ps`); other POSIX platforms
 * use `ps -o lstart=`. Windows is unsupported (null). Never throws.
 * See change: fix-gateway-socket-stale-owner (D3).
 */
export function processStartedAt(pid: number, opts: ProcessStartedAtOpts = {}): number | null {
  const platform = opts.platform ?? process.platform;
  if (!Number.isInteger(pid) || pid <= 0 || platform === "win32") return null;
  try {
    if (platform === "linux") {
      const read = opts.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));
      return parseProcStartMs(read(`/proc/${pid}/stat`), read("/proc/stat"));
    }
    const exec = opts.exec ?? defaultExec;
    const out = String(exec(`LC_ALL=C ps -o lstart= -p ${pid}`, { encoding: "utf-8" })).trim();
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Outcome of a signal-0 probe, distinguishing PROOF of absence from denial. */
export type SignalZeroOutcome = "alive" | "esrch" | "other-errno";

/**
 * Errno-aware liveness probe for KILL DECISIONS. Unlike `isProcessAlive`
 * (which catches any throw → "dead"), this distinguishes a signal-0 failure
 * by errno: `"esrch"` is PROOF the process does not exist; `"other-errno"`
 * — notably `EPERM` (process alive but owned by another user / hardened) —
 * must read as ALIVE so a caller never terminates a live process on a
 * permission denial. PID reuse on POSIX reads `"alive"` (safe direction:
 * exit deferred, never false).
 * See change: fix-autostart-discovery-precedence (D6).
 */
export function signalZero(pid: number, opts: { kill?: KillFn } = {}): SignalZeroOutcome {
  const kill = opts.kill ?? defaultKill;
  try {
    kill(pid, 0);
    return "alive";
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ESRCH" ? "esrch" : "other-errno";
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
