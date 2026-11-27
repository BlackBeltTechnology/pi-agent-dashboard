/**
 * Coexistence with ship-batch (design D10, task 3.15): the group preflight refuses `batch_runner_active` when
 * `<repo>/.worktrees/.ship-batch/lock` is LIVE by ship-batch's own rules.
 *
 * Why a port and not an import: the reader lives in the repo-local skill `.pi/skills/ship-batch/scripts/lock.ts`
 * (`lockDecision`, `LOCK_STALE_MS`, `pidAlive`), which is outside this published package (`files: src/ …`), so
 * it cannot be imported. The SAME rules are ported here and `coexistence.test.ts` runs both side by side
 * (parity matrix) when the skill is present:
 *   - record = `{pid, hostname, groupId, heartbeatAt}`;
 *   - heartbeat age ≥ 10 min (`LOCK_STALE_MS`) ⇒ stale;
 *   - same host and the pid is dead (signal-0 probe via `isProcessAlive`, `EPERM` = alive) ⇒ stale;
 *   - heartbeat more than 60 s in the future ⇒ stale (clock skew / a forged lock; a rule of THIS change);
 *   - a missing, empty or unparseable lock ⇒ not live (the start proceeds);
 *   - another host with a fresh heartbeat ⇒ live.
 * Known difference: ship-batch's `lockDecision` refuses any other-host lock even when old; the group start
 * follows the spec (live only while the heartbeat is younger than 10 min). The lock is only READ here.
 * See change: add-agent-teams-openspec.
 */
import os from "node:os";
import path from "node:path";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { readBoundedFile } from "./inputs.js";

export const BATCH_LOCK_STALE_MS = 10 * 60_000;
const BATCH_LOCK_FUTURE_SKEW_MS = 60_000;
const BATCH_LOCK_MAX_BYTES = 64 * 1024;

export interface BatchLockInfo {
  pid: number;
  hostname: string;
  groupId: string;
  heartbeatAt: number;
}

/** `<repo>/.worktrees/.ship-batch/lock`. */
export const batchLockPath = (repo: string): string => path.join(repo, ".worktrees", ".ship-batch", "lock");

function pidAlive(pid: number): boolean {
  return isProcessAlive(pid, { epermAlive: true });
}

/** Parse the lock text; `null` for anything that is not a complete record. */
function parseBatchLock(raw: string): BatchLockInfo | null {
  try {
    const v = JSON.parse(raw) as Partial<BatchLockInfo> | null;
    if (!v || typeof v !== "object") return null;
    if (typeof v.pid !== "number" || !Number.isFinite(v.pid) || typeof v.hostname !== "string" || typeof v.heartbeatAt !== "number" || !Number.isFinite(v.heartbeatAt)) return null;
    return { pid: v.pid, hostname: v.hostname, groupId: typeof v.groupId === "string" ? v.groupId : "", heartbeatAt: v.heartbeatAt };
  } catch {
    return null;
  }
}

/** Is a parsed lock live at `now`? (the rules of the module comment) */
export function batchLockLive(info: BatchLockInfo, now: number, self: { hostname: string }, isAlive: (pid: number) => boolean = pidAlive): boolean {
  if (info.heartbeatAt > now + BATCH_LOCK_FUTURE_SKEW_MS) return false;
  if (now - info.heartbeatAt >= BATCH_LOCK_STALE_MS) return false;
  if (info.hostname === self.hostname && !isAlive(info.pid)) return false;
  return true;
}

export interface BatchRunnerOptions {
  now: number;
  hostname?: string;
  isAlive?: (pid: number) => boolean;
}

export type BatchRunnerVerdict = { active: false } | { active: true; pid: number; groupId: string; hostname: string };

/** Read the lock of `repo` and decide. A missing / unreadable / unparseable lock never blocks a start. */
export function checkBatchRunner(repo: string, opts: BatchRunnerOptions): BatchRunnerVerdict {
  const read = readBoundedFile(batchLockPath(repo), BATCH_LOCK_MAX_BYTES);
  if (!read.ok) return { active: false };
  const info = parseBatchLock(read.text);
  if (!info) return { active: false };
  return batchLockLive(info, opts.now, { hostname: opts.hostname ?? os.hostname() }, opts.isAlive)
    ? { active: true, pid: info.pid, groupId: info.groupId, hostname: info.hostname }
    : { active: false };
}
