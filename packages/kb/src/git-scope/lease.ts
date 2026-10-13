// Single-writer lease with fencing (design G4). One row in `git_lease`; acquire,
// extend and release are `UPDATE … WHERE` statements in `immediate()` so SQLite
// serialises them across processes. Every write transaction re-checks the nonce
// in-transaction, so a deposed owner cannot write after a take-over.
import { randomUUID } from "node:crypto";
import type { KbStore, RawDb } from "../types.js";

export class LeaseLostError extends Error {
  constructor() {
    super("git-scope lease lost");
    this.name = "LeaseLostError";
  }
}

export class GitLease {
  private nonce: string | null = null;
  private readonly store: KbStore;
  private readonly opts: { owner: string; leaseMs: number; now: () => number };
  constructor(store: KbStore, opts: { owner: string; leaseMs: number; now: () => number }) {
    this.store = store;
    this.opts = opts;
  }

  get held(): boolean {
    return this.nonce !== null;
  }

  /** Non-blocking: true iff this call took the lease (busy DB ⇒ not acquired). */
  tryAcquire(): boolean {
    const nonce = randomUUID();
    try {
      const won = this.store.immediate!((db) => {
        const now = this.opts.now();
        const r = db.prepare("UPDATE git_lease SET owner=?, nonce=?, expires_at=? WHERE id=1 AND expires_at < ?").run(this.opts.owner, nonce, now + this.opts.leaseMs, now);
        return Number(r.changes) === 1;
      });
      this.nonce = won ? nonce : null;
      return won;
    } catch {
      return false;
    }
  }

  /** Heartbeat. Zero rows changed ⇒ lost. */
  extend(): boolean {
    if (!this.nonce) return false;
    const nonce = this.nonce;
    try {
      const ok = this.store.immediate!((db) => Number(db.prepare("UPDATE git_lease SET expires_at=? WHERE id=1 AND nonce=?").run(this.opts.now() + this.opts.leaseMs, nonce).changes) === 1);
      if (!ok) this.nonce = null;
      return ok;
    } catch {
      return false; // busy: not provably lost, but the caller aborts conservatively
    }
  }

  /** Fenced release: never touches another owner's lease. */
  release(): void {
    if (!this.nonce) return;
    const nonce = this.nonce;
    this.nonce = null;
    try {
      this.store.immediate!((db) => void db.prepare("UPDATE git_lease SET expires_at=0 WHERE id=1 AND nonce=?").run(nonce));
    } catch { /* expiry will free it */ }
  }

  /** One write transaction, fenced by the nonce; also extends the lease. Throws
   *  {@link LeaseLostError} (rolling back) when this owner was deposed. */
  fenced<T>(fn: (db: RawDb) => T): T {
    const nonce = this.nonce;
    if (!nonce) throw new LeaseLostError();
    return this.store.immediate!((db) => {
      const row = db.prepare("SELECT nonce FROM git_lease WHERE id=1").get() as { nonce: string } | undefined;
      if (!row || row.nonce !== nonce) throw new LeaseLostError();
      const out = fn(db);
      db.prepare("UPDATE git_lease SET expires_at=? WHERE id=1 AND nonce=?").run(this.opts.now() + this.opts.leaseMs, nonce);
      return out;
    });
  }
}
