/**
 * Process identification primitives — find PIDs by command-line marker,
 * check if a PID looks like a pi-related process.
 *
 * Every OS-dependent helper accepts injectable `platform` and `exec`
 * parameters, defaulting to `process.platform` and a safe `execSync`.
 * Tests exercise both branches without mutating `process.platform`.
 *
 * Windows branches are intentional stubs today: there is no cheap,
 * format-stable cross-command way to inspect a PID's command line
 * (tasklist /V is slow and locale-dependent). Windows pi-ness is
 * verified via `headlessPidRegistry` at the server level, which tracks
 * PID → session identity directly at spawn time. Future work can
 * extend these Windows branches with WMIC / PowerShell probing in
 * ONE place (here) instead of the three scattered inline checks in
 * session-action-handler.ts.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
import { execSync } from "./exec.js";

export type ExecFn = (cmd: string, opts: { encoding: "utf-8"; timeout?: number; stdio?: any }) => string;

export interface ProcessIdentifyOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override execSync (for tests). */
  exec?: ExecFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8"; timeout?: number; stdio?: any }): string {
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
}

// ── Pattern matcher ─────────────────────────────────────────────────────────

/** Returns true iff the given command-line string references pi or node. */
export function isPiCommandLine(commandLine: string): boolean {
  return /\bpi\b|\bnode\b/.test(commandLine);
}

// ── findPidByMarker ─────────────────────────────────────────────────────────

/**
 * Find PIDs whose command line contains `marker`. Unix uses ps|grep;
 * Windows returns `[]` (command-line lookup is delegated to
 * headlessPidRegistry at the server level).
 *
 * Never throws. Returns `[]` on any error.
 */
export function findPidByMarker(marker: string, opts: ProcessIdentifyOpts = {}): number[] {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return [];

  const exec = opts.exec ?? defaultExec;
  // Additional sentinels help distinguish pi headless spawns from other
  // processes that happen to contain the session ID in an env var or
  // unrelated argument. The canonical sentinels match the Unix headless
  // wrapper strings.
  const sentinels = ["sleep 2147483647", "tail -f /dev/null"];

  try {
    const out = exec(
      `ps -eo pid,command | grep ${shellQuote(marker)} | grep -v grep`,
      { encoding: "utf-8", timeout: 3000 },
    ).trim();
    if (!out) return [];

    const pids: number[] = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Must also contain one of the pi headless sentinels, else it's
      // probably a grep/editor/tail-of-log matching the session id.
      const hasSentinel = sentinels.some((s) => trimmed.includes(s));
      if (!hasSentinel) continue;
      const pidStr = trimmed.split(/\s+/, 1)[0];
      const pid = parseInt(pidStr, 10);
      if (pid > 0) pids.push(pid);
    }
    return pids;
  } catch {
    return [];
  }
}

// ── isProcessLikePi ────────────────────────────────────────────────────────

/**
 * Check if a PID belongs to a pi/node process. Safety check before
 * SIGKILL on Unix; no-op on Windows where pi-ness is tracked by
 * the PID registry at spawn time.
 *
 * Unix behaviour:
 *   - macOS: `ps -p <pid> -o command=`
 *   - Linux: `/proc/<pid>/cmdline` with `ps` fallback via `cat`
 *
 * Returns `false` if the process has already exited (command fails).
 * Returns `true` on Windows unconditionally.
 */
export function isProcessLikePi(pid: number, opts: ProcessIdentifyOpts = {}): boolean {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return true;

  const exec = opts.exec ?? defaultExec;
  const cmd = platform === "darwin"
    ? `ps -p ${pid} -o command=`
    : `cat /proc/${pid}/cmdline 2>/dev/null || ps -p ${pid} -o command=`;

  try {
    const output = exec(cmd, { encoding: "utf-8", timeout: 2000 }).trim();
    return isPiCommandLine(output);
  } catch {
    return false;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function shellQuote(s: string): string {
  // Strict allow-list: if the marker is purely [A-Za-z0-9._-], leave it alone;
  // otherwise single-quote it safely. Session IDs are UUIDs or similar and
  // fall into the allow-list in practice, so this is almost always a no-op.
  if (/^[A-Za-z0-9._-]+$/.test(s)) return `"${s}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
