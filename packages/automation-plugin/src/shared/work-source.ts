/**
 * Work-source contract — the generic, fenced competing-consumers seam the
 * automation engine uses to obtain concrete work items.
 *
 * A work-source vends **leased handles**, never bare items, so acknowledgement
 * can be fenced: `ack`/`nack` are conditional on the presented token still
 * being the item's current lease (a stale/expired token is a no-op). The
 * engine stays domain-free — what an item is, and how availability is
 * enumerated, lives entirely behind this contract.
 *
 * See change: automation-work-source-fanout.
 */

/** A single leased work item handed to one child. */
export interface LeasedHandle<T = unknown> {
  /** The domain item the child processes (opaque to the engine). */
  item: T;
  /** Fencing token for this lease. Passed back to `ack`/`nack`. */
  leaseToken: string;
  /**
   * Stable per-item idempotency key derived from the item's identity (NOT the
   * lease token): the SAME item redelivered on a later fire after its lease
   * expired carries the SAME key, so an idempotent action processes it once.
   */
  idempotencyKey: string;
}

/** A fenced competing-consumers work-source. */
export interface WorkSource<T = unknown> {
  /**
   * Lease up to `n` distinct available items and return their handles. An item
   * holding a valid lease SHALL NOT be returned again (single-flight). Fewer
   * than `n` handles means fewer items were available; zero means none.
   */
  next(n: number): LeasedHandle<T>[];
  /** Drop the item permanently — conditional on `leaseToken` being current. */
  ack(leaseToken: string): void;
  /** Return the item to the available pool — conditional on `leaseToken` being current. */
  nack(leaseToken: string): void;
}
