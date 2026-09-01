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
 * See change: automation-work-source-fanout, relocate-fanout-to-work-source.
 */

/**
 * Per-call context the engine hands a source at lease time. Carries the firing
 * automation's scope base, so ONE registered source id can serve N workspaces
 * (a source whose availability is workspace-scoped reads `cwd`; a source that
 * owns a fixed backing store — like the folder source — ignores it).
 * OPTIONAL for the source: an implementation may take no second argument.
 * See change: relocate-fanout-to-work-source.
 */
export interface WorkSourceContext {
  /** Scope base of the automation whose fire is leasing (its workspace root). */
  cwd: string;
}

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

/** Members every work-source shares, whatever its vend timing. */
interface WorkSourceCommon<T> {
  /**
   * OPTIONAL targeted lease: lease the ONE available item whose
   * `idempotencyKey` is `key`. `null` means unavailable — either already
   * leased (so this IS the single-flight refusal for a targeted run) or gone.
   * A source that cannot address items by key omits this method, and a
   * targeted run against it reports `unsupported`.
   * See change: relocate-fanout-to-work-source.
   */
  take?(
    key: string,
    ctx?: WorkSourceContext,
  ): LeasedHandle<T> | null | Promise<LeasedHandle<T> | null>;
  /** Drop the item permanently — conditional on `leaseToken` being current. */
  ack(leaseToken: string): void;
  /** Return the item to the available pool — conditional on `leaseToken` being current. */
  nack(leaseToken: string): void;
}

/** A fenced competing-consumers work-source vending SYNCHRONOUSLY. */
export interface WorkSource<T = unknown> extends WorkSourceCommon<T> {
  /**
   * Lease up to `n` distinct available items and return their handles. An item
   * holding a valid lease SHALL NOT be returned again (single-flight). Fewer
   * than `n` handles means fewer items were available; zero means none.
   * `ctx` is supplied by the engine and may be ignored.
   */
  next(n: number, ctx?: WorkSourceContext): LeasedHandle<T>[];
}

/**
 * A work-source whose vend MAY resolve asynchronously — the shape a source
 * needs when its availability lives behind an async port (DB, REST, another
 * plugin) and cannot be enumerated synchronously. The engine awaits the
 * result; a rejection leases NOTHING.
 *
 * Strictly a WIDENING: every {@link WorkSource} is a valid `AsyncWorkSource`,
 * so a synchronous source (e.g. the folder source) satisfies both unchanged.
 * See change: relocate-fanout-to-work-source.
 */
export interface AsyncWorkSource<T = unknown> extends WorkSourceCommon<T> {
  next(n: number, ctx?: WorkSourceContext): LeasedHandle<T>[] | Promise<LeasedHandle<T>[]>;
}

/** Either vend timing — what the registry holds and the engine consumes. */
export type AnyWorkSource<T = unknown> = WorkSource<T> | AsyncWorkSource<T>;
