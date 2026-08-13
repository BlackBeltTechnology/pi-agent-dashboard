/**
 * Single-flight auto-start lock (D2).
 *
 * Nothing serialises the check→spawn window across processes, so N pi
 * sessions each observe "no dashboard" and each spawn one. An advisory
 * lockfile at `~/.pi/dashboard/autostart-<port>.lock`, acquired with an
 * atomic `open(..., 'wx')`, admits exactly one spawner per user per port.
 *
 * Staleness is deliberately more than "is the pid alive":
 *   - the spawned server is `detached: true`, so a dead session does not mean
 *     a dead spawn — the recorded `childPid` is consulted too (E5);
 *   - a reused pid makes a dead holder look alive, so the holder process's
 *     start time is cross-checked against the recorded `startedAt` (E6);
 *   - a holder that simply died without cleaning up must not wedge auto-start
 *     forever, so the lock also expires past `SPAWN_READINESS_BUDGET_MS` (E8).
 *
 * SCOPE — this lock is ADVISORY, and deliberately so. The atomic `wx` create
 * makes the common uncontended path exact, but the break-and-reacquire path
 * (`rmSync` + re-create) and `recordChildPid`'s rewrite are two-step and can
 * interleave under a rare double-break. The backstop for that residual window
 * is the server side of this same change: a loser that does spawn now binds,
 * fails, tears its listeners down and exits rather than lingering on the
 * gateway port. Making the lock exact would need a rename-based claim; it is
 * not worth the complexity given that backstop.
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { execFileSync } from "node:child_process"; // ban:child_process-ok — pid start-time probe
import { join } from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { SPAWN_READINESS_BUDGET_MS } from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** On-disk lock record. `sessionPid` is the ONLY spelling of the holder pid. */
export interface AutoStartLockRecord {
  /** pid of the pi session holding the lock. */
  sessionPid: number;
  /** epoch ms at which the lock was acquired. */
  startedAt: number;
  /** resolved server CLI path the holder is spawning. */
  cliPath: string;
  /** pid of the detached server child, once known. */
  childPid?: number;
}

/** Injectable OS probes (tests substitute; production uses the real ones). */
export interface LockProbes {
  now: () => number;
  /** True when a process with this pid exists. */
  isAlive: (pid: number) => boolean;
  /** Process start time in epoch ms, or null when unknown/dead. */
  processStartedAt: (pid: number) => number | null;
}

export function defaultProbes(): LockProbes {
  return {
    now: Date.now,
    isAlive: (pid) => isProcessAlive(pid),
    processStartedAt: (pid) => {
      // `ps` is POSIX. On Windows the spawn simply fails and the catch below
      // returns null, which disables pid-reuse detection there: staleness
      // falls back to liveness plus the age bound. Degrading is the correct
      // direction — a false "stale" verdict would break a LIVE holder's lock
      // and double-spawn, which is the bug this lock exists to prevent.
      try {
        const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
          encoding: "utf8",
        }).trim();
        if (!out) return null;
        const ms = Date.parse(out);
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    },
  };
}

export function autoStartLockPath(port: number, dir?: string): string {
  return join(dir ?? getDashboardConfigDir(), `autostart-${port}.lock`);
}

/** Pid-reuse tolerance: a holder that started this long AFTER the lock is a reuse. */
const PID_REUSE_SLACK_MS = 2_000;

/**
 * Pure staleness decision. A stale lock may be broken and re-acquired.
 *
 * Order matters: an alive detached child keeps the lock live even when the
 * session that started it is gone (E5), because breaking the lock there would
 * race the child that is still binding the port.
 */
export function isLockStale(
  lock: AutoStartLockRecord | null,
  probes: LockProbes,
  budgetMs: number = SPAWN_READINESS_BUDGET_MS,
): boolean {
  // Unreadable / corrupt lock (X7): stale and breakable, never a throw.
  if (!lock || typeof lock.sessionPid !== "number" || typeof lock.startedAt !== "number") {
    return true;
  }

  // E5: the detached child outlives the session — an alive child holds the lock.
  if (typeof lock.childPid === "number" && probes.isAlive(lock.childPid)) return false;

  const holderAlive = probes.isAlive(lock.sessionPid);

  // E6: pid reuse — the "holder" is a younger process that inherited the pid.
  if (holderAlive) {
    const started = probes.processStartedAt(lock.sessionPid);
    if (started !== null && started > lock.startedAt + PID_REUSE_SLACK_MS) return true;
  } else {
    return true;
  }

  // E7/E8: even a live holder cannot hold past the readiness budget.
  return probes.now() - lock.startedAt > budgetMs;
}

export function readLock(path: string): AutoStartLockRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AutoStartLockRecord;
  } catch {
    // Absent OR corrupt JSON (X7) — both mean "no valid holder".
    return null;
  }
}

export interface AcquireResult {
  /** True when this process now owns the lock. */
  acquired: boolean;
  /** The record blocking acquisition (for the X3 log line). */
  holder?: AutoStartLockRecord | null;
  /** True when the lock could not be used at all (X6: unwritable dir). */
  degraded?: boolean;
}

function writeLockFile(path: string, record: AutoStartLockRecord): boolean {
  try {
    // Atomic create-or-fail. Losing this race means another session won.
    const fd = openSync(path, "wx");
    try {
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to become the single flight for `port`.
 *
 * X6: when the lock directory is unwritable we DEGRADE to the pre-lock
 * behaviour (`acquired: true, degraded: true`) rather than throwing — losing
 * single-flight is strictly better than losing auto-start.
 */
export function acquireAutoStartLock(
  args: { port: number; cliPath: string; dir?: string; sessionPid?: number },
  probes: LockProbes = defaultProbes(),
  budgetMs: number = SPAWN_READINESS_BUDGET_MS,
): AcquireResult {
  const path = autoStartLockPath(args.port, args.dir);
  const record: AutoStartLockRecord = {
    sessionPid: args.sessionPid ?? process.pid,
    startedAt: probes.now(),
    cliPath: args.cliPath,
  };

  if (writeLockFile(path, record)) return { acquired: true };

  // Someone holds it — or the directory is unwritable.
  const holder = readLock(path);
  if (holder === null && !isReadableFile(path)) {
    // The create failed and we cannot read a lock record back — the directory
    // or the file is unusable (X6: unwritable/unreadable). Degrade rather than
    // block auto-start: losing single-flight beats losing the dashboard.
    return { acquired: true, degraded: true };
  }

  if (!isLockStale(holder, probes, budgetMs)) return { acquired: false, holder };

  // Stale: break it and retry once. A concurrent breaker may beat us — then
  // we genuinely lost and must not spawn.
  try {
    rmSync(path, { force: true });
  } catch {
    return { acquired: false, holder };
  }
  if (writeLockFile(path, { ...record, startedAt: probes.now() })) return { acquired: true };
  return { acquired: false, holder: readLock(path) };
}

/**
 * True only when the lock file exists AND we can read it. An absent file, or
 * one we cannot read (EACCES/EPERM), both mean "no holder we can honour" —
 * treating an unreadable lock as held would wedge auto-start instead of
 * degrading (X6).
 */
function isReadableFile(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Record the detached child's pid once the launch primitive surfaces it. */
export function recordChildPid(
  port: number,
  childPid: number,
  dir?: string,
  sessionPid: number = process.pid,
): void {
  const path = autoStartLockPath(port, dir);
  const lock = readLock(path);
  // Only mutate a lock we still own. A holder that overran the budget may find
  // its lock already broken and re-acquired by someone else; writing into that
  // record would corrupt the new holder's state.
  if (!lock || lock.sessionPid !== sessionPid) return;
  try {
    const fd = openSync(path, "w");
    try {
      writeSync(fd, JSON.stringify({ ...lock, childPid }));
    } finally {
      closeSync(fd);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Release the lock. MUST run in a `finally` covering ready, failed and
 * timed-out spawns (E9) — otherwise a failed spawn wedges every other
 * session until the staleness budget elapses.
 */
export function releaseAutoStartLock(
  port: number,
  dir?: string,
  sessionPid: number = process.pid,
): void {
  const path = autoStartLockPath(port, dir);
  // Same ownership rule as `recordChildPid`: never delete a lock that is no
  // longer ours, or a slow holder's `finally` frees the NEW holder's lock and
  // re-opens the double-spawn window the lock exists to close.
  const lock = readLock(path);
  if (lock && lock.sessionPid !== sessionPid) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* best-effort */
  }
}
