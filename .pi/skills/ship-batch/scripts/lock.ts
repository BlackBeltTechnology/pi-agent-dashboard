/**
 * Lock decision (pure apart from the injectable pid probe).
 *
 * `<repo>/.worktrees/.ship-batch/lock` = `{pid, hostname, groupId, heartbeatAt}`
 * (D7). Different host → refuse; same host + pid alive + heartbeat < 10 min →
 * refuse naming the pid; otherwise take over.
 *
 * See change: add-ship-batch-orchestrator.
 */

export interface LockInfo {
  pid: number;
  hostname: string;
  groupId: string;
  heartbeatAt: number;
}

export const LOCK_STALE_MS = 10 * 60_000;

export type LockDecision =
  | { action: "acquire" }
  | { action: "takeover" }
  | { action: "refuse"; reason: string };

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockDecision(
  lock: LockInfo | null,
  self: { hostname: string; pid: number },
  now: number,
  isAlive: (pid: number) => boolean = pidAlive,
): LockDecision {
  if (!lock) return { action: "acquire" };
  if (lock.hostname !== self.hostname) {
    return { action: "refuse", reason: `lock held by pid ${lock.pid} on host ${lock.hostname} (group ${lock.groupId})` };
  }
  if (isAlive(lock.pid) && now - lock.heartbeatAt < LOCK_STALE_MS) {
    return { action: "refuse", reason: `another ship-batch runner is active: pid ${lock.pid} (group ${lock.groupId})` };
  }
  return { action: "takeover" };
}
