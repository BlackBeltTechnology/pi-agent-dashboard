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

type ExecFn = (cmd: string, opts: { encoding: "utf-8"; timeout?: number; stdio?: any }) => string;

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

// ── findPidsBySpawnToken ────────────────────────────────────

/**
 * Find PIDs whose ENVIRONMENT carries `PI_DASHBOARD_SPAWN_TOKEN=<token>`.
 *
 * This is the one handle that exists for a spawn the dashboard cannot address
 * any other way. `tmux new-window` returns tmux's pid, not pi's, and the pane
 * runs `cd <cwd> && pi` with nothing identifying on its command line — so a pi
 * that never sends `session_register` (blocked on the interactive trust prompt,
 * for instance) has no pid, no session record, and nothing that can reclaim it.
 * The server already mints the token and passes it into the pane's env, so the
 * environment is where the correlation survives.
 *
 * Command line is deliberately NOT searched: the token is never on it, and a
 * `grep <token>` over `ps` output would match this very lookup.
 *
 * The result is narrowed to processes actually NAMED `pi`, and that narrowing
 * is load-bearing rather than cosmetic. The token is an ordinary environment
 * variable, so it is INHERITED: the tmux server that outlives the first spawn,
 * the dashboard's own node process, the pane's shell and any child all carry
 * it. An un-narrowed lookup returned five pids for one token, and handing that
 * set to a kill path took the whole container down. Only the leaf `pi` is ever
 * a legitimate target.
 *
 * Never throws. Returns `[]` on any error or on Windows.
 *
 * See change: fix-tmux-session-shutdown-leak (design D5).
 */
export function findPidsBySpawnToken(
  token: string,
  opts: ProcessIdentifyOpts = {},
): number[] {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return [];
  // An empty/blank token would match every process that merely has the variable
  // set — refuse rather than hand a kill path a wildcard.
  if (!/^[A-Za-z0-9._-]{8,}$/.test(token)) return [];

  const exec = opts.exec ?? defaultExec;
  const needle = `PI_DASHBOARD_SPAWN_TOKEN=${token}`;
  const isDarwin = platform === "darwin";

  try {
    const out = exec(spawnTokenProbe(needle, isDarwin), {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (!out) return [];
    // On darwin `ps` lists EVERY process, so the token is matched per line; on
    // linux the shell already filtered and each line IS a pid.
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const matching = isDarwin
      ? lines.filter((l) => l.includes(needle) && isPiExecutable(l.split(/\s+/)[1] ?? ""))
      : lines;
    return matching
      .map((l) => Number.parseInt(l.split(/\s+/, 1)[0] ?? "", 10))
      .filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

/**
 * The per-platform probe: `/proc/<pid>/environ` on linux (exact and cheap),
 * BSD `ps -E` on darwin (no /proc; `-E` appends the environment).
 */
function spawnTokenProbe(needle: string, isDarwin: boolean): string {
  // `comm` (2nd column) is what the pi-only narrowing keys on.
  if (isDarwin) return "ps -Aww -E -o pid=,comm=,command=";
  // `; exit 0` is load-bearing: the loop's status is the LAST iteration's, and
  // the last /proc entry almost never matches, so `grep -q` left the shell at
  // status 1. execSync throws on non-zero, the catch swallowed it, and the
  // probe silently returned [] for every lookup — measured in the harness as a
  // watchdog that fired but never reclaimed anything.
  // See change: fix-tmux-session-shutdown-leak.
  return (
    `for d in /proc/[0-9]*; do ` +
    // Leaf pi only: the token is inherited by the tmux server, the dashboard's
    // own node process and every shell in between.
    `[ "$(cat "$d/comm" 2>/dev/null)" = "pi" ] || continue; ` +
    `tr '\\0' '\\n' < "$d/environ" 2>/dev/null | ` +
    `grep -q ${shellQuote(needle)} && echo "\${d#/proc/}"; done; exit 0`
  );
}

/** True when a `ps` comm column names the pi binary (never `node`, never a shell). */
function isPiExecutable(comm: string): boolean {
  return comm.split("/").pop() === "pi";
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
