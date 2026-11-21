/**
 * The on-disk runner lock (`<repo>/.worktrees/.ship-batch/lock`).
 *
 * - Publication is atomic and complete: the owner record is written to a temp
 *   file and `link`ed into place (fails with EEXIST when held), so a contender
 *   can never observe a half-written lock.
 * - Replacing a stale lock is serialised by a short-lived `lock.takeover` mutex,
 *   and re-checks the lock under it, so a contender's stale decision can never
 *   remove a different owner's fresh lock.
 * - Ownership is positive: only a readable record with our pid + host counts. A
 *   missing or unreadable file is "not ours" (never re-created by a heartbeat).
 * - An unreadable lock is inconclusive: refused until its mtime is itself stale.
 *
 * See change: add-ship-batch-orchestrator (D7).
 */
import fs from "node:fs";
import { LOCK_STALE_MS, type LockInfo, lockDecision } from "./lock.ts";

export class LockRefused extends Error {}

const MUTEX_STALE_MS = 30_000;

export interface LockOwner {
  pid: number;
  hostname: string;
}

export class LockFile {
  held = false;

  constructor(
    private readonly file: string,
    private readonly self: LockOwner,
    private readonly now: () => number,
    private readonly isAlive?: (pid: number) => boolean,
  ) {}

  private record(groupId: string): string {
    const info: LockInfo = { pid: this.self.pid, hostname: this.self.hostname, groupId, heartbeatAt: this.now() };
    return JSON.stringify(info);
  }

  /** Atomically create the lock with its full content; false when it already exists. */
  private publish(groupId: string): boolean {
    const tmp = `${this.file}.${this.self.pid}.${this.now()}.tmp`;
    fs.writeFileSync(tmp, this.record(groupId));
    try {
      fs.linkSync(tmp, this.file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** The raw lock text, `null` when it does not exist, `undefined` when it cannot be read. */
  private readRaw(): string | null | undefined {
    try {
      return fs.readFileSync(this.file, "utf8");
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
    }
  }

  private parse(raw: string): LockInfo | null {
    try {
      const v = JSON.parse(raw) as Partial<LockInfo>;
      return typeof v.pid === "number" && typeof v.hostname === "string" && typeof v.heartbeatAt === "number" ? (v as LockInfo) : null;
    } catch {
      return null;
    }
  }

  /** Verdict on the current lock: a holder to honour, or `null` when it may be replaced. */
  private holderOrStale(raw: string | undefined): string | null {
    const info = raw === undefined ? null : this.parse(raw);
    if (info) {
      const d = lockDecision(info, this.self, this.now(), this.isAlive);
      return d.action === "refuse" ? d.reason : null;
    }
    // Unreadable / malformed: inconclusive until the file itself is stale.
    try {
      const age = this.now() - fs.statSync(this.file).mtimeMs;
      return age < LOCK_STALE_MS ? "the lock file exists but cannot be read (another runner may be starting)" : null;
    } catch {
      return null;
    }
  }

  /** Take the short-lived takeover mutex; a stale one (crashed holder) is cleared once. */
  private takeMutex(guard: string): number {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return fs.openSync(guard, "wx");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (this.mutexAge(guard) < MUTEX_STALE_MS) throw new LockRefused("another runner is replacing the lock");
        fs.rmSync(guard, { force: true });
      }
    }
    throw new LockRefused("could not take the lock replacement mutex");
  }

  private mutexAge(guard: string): number {
    try {
      return this.now() - fs.statSync(guard).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY; // vanished: treat as stale and retry
    }
  }

  /** Remove `expectedRaw` under the takeover mutex; no-op when the lock changed meanwhile. */
  private replaceStale(expectedRaw: string | undefined): void {
    const guard = `${this.file}.takeover`;
    const fd = this.takeMutex(guard);
    try {
      if (this.readRaw() === expectedRaw) fs.rmSync(this.file, { force: true });
    } finally {
      fs.closeSync(fd);
      fs.rmSync(guard, { force: true });
    }
  }

  acquire(groupId: string): void {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.publish(groupId)) {
        this.held = true;
        return;
      }
      const raw = this.readRaw();
      if (raw === null) continue; // vanished between the attempts: publish again
      const reason = this.holderOrStale(raw);
      if (reason) throw new LockRefused(reason);
      this.replaceStale(raw);
    }
    throw new LockRefused("could not acquire the ship-batch lock (lost a race)");
  }

  /** Positive ownership: a readable record with our pid and host. */
  isOurs(): boolean {
    const raw = this.readRaw();
    const info = typeof raw === "string" ? this.parse(raw) : null;
    return info !== null && info.pid === this.self.pid && info.hostname === this.self.hostname;
  }

  /** Refresh `heartbeatAt`. `lost` when the lock is no longer ours (never overwrites a successor). */
  heartbeat(groupId: string): "ok" | "lost" {
    if (!this.held) return "lost";
    if (!this.isOurs()) {
      this.held = false;
      return "lost";
    }
    const tmp = `${this.file}.${this.self.pid}.hb.tmp`;
    fs.writeFileSync(tmp, this.record(groupId));
    fs.renameSync(tmp, this.file);
    return "ok";
  }

  /** Remove the lock iff it is still ours. Idempotent. */
  release(): void {
    if (this.held && this.isOurs()) fs.rmSync(this.file, { force: true });
    this.held = false;
  }
}
