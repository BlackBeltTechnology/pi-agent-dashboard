/**
 * Queued-invoice work source — THE place invoice knowledge lives for automation
 * fan-out.
 *
 * The automation plugin owns a generic, fenced competing-consumers seam
 * (`WorkSource`: lease up to n distinct items, `ack` to drop, `nack` to return);
 * it knows nothing about invoices. This module implements that seam over the
 * InvoiceEngine's queued list, and the plugin registers it under the id an
 * automation names in `on: { kind: schedule.batch, source: … }`.
 *
 * What the lease map buys us — every one of these is a guarantee, not a detail:
 *   - ONE INVOICE PER SESSION: one leased handle ⇒ one spawned child, and the
 *     id rides `${{trigger}}` into that child's payload + env;
 *   - DISTINCT INVOICE PER CHILD: a leased id is never vended again, so N
 *     concurrent children of one fire can never race for the same record;
 *   - SINGLE-FLIGHT PER INVOICE: the same map refuses `take()` for an id that
 *     already has a live run, so the scheduler fan-out and a targeted
 *     run-this-invoice request cannot both dispatch the same invoice;
 *   - NO PHANTOM RUN: an empty queue vends zero handles, and the automation
 *     engine spawns NOTHING for an empty vend (it settles a completed no-op);
 *   - NO PERMANENT STRANDING: every terminal run status releases the lease
 *     (`done` → ack, anything else → nack), and a run that dies without any
 *     terminal signal frees its invoice when the lease expires.
 *
 * The vend is ASYNCHRONOUS because the InvoiceEngine port is: queued invoices
 * live behind `engine.query(cwd, { view: "list", state: "queued" })`. Leases are
 * process-local (mirroring the automation plugin's own folder source), which is
 * sound because one dashboard process owns the spawns it fans out.
 *
 * See change: relocate-fanout-to-work-source.
 */

/** Default lease lifetime: a leased invoice returns to the pool after this
 *  when no terminal run status ever releases it (crashed/lost run). */
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The automation plugin's work-source contract, restated structurally.
 *
 * Deliberately NOT imported from the automation plugin: the seam is a runtime
 * service (`ctx.provide`/`ctx.consumeAll`), so a compile-time dependency between
 * two sibling plugins would buy nothing and couple their build graphs. Keep in
 * step with `automation-plugin/src/shared/work-source.ts`.
 */
export interface LeasedHandle<T> {
  item: T;
  leaseToken: string;
  idempotencyKey: string;
}

/** Per-call context the engine supplies: the firing automation's workspace. */
export interface WorkSourceContext {
  cwd: string;
}

export interface AsyncWorkSource<T> {
  next(n: number, ctx?: WorkSourceContext): Promise<LeasedHandle<T>[]>;
  take(key: string, ctx?: WorkSourceContext): Promise<LeasedHandle<T> | null>;
  ack(leaseToken: string): void;
  nack(leaseToken: string): void;
}

export interface QueuedInvoiceSourceDeps {
  /**
   * Queued invoice ids for a workspace. MUST NOT throw — an unreadable store
   * yields an empty list, which vends nothing (and therefore spawns nothing).
   */
  listQueued: (cwd: string) => Promise<string[]>;
  /** Lease lifetime; a lease older than this is reclaimed on the next call. */
  visibilityTimeoutMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

interface Lease {
  token: string;
  invoiceId: string;
  expiresAt: number;
}

/** Create the queued-invoice work source (one stable instance per plugin). */
export function createQueuedInvoiceWorkSource(deps: QueuedInvoiceSourceDeps): AsyncWorkSource<string> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const ttl = deps.visibilityTimeoutMs && deps.visibilityTimeoutMs > 0
    ? deps.visibilityTimeoutMs
    : DEFAULT_VISIBILITY_TIMEOUT_MS;

  /** leaseToken → lease (the fencing record). */
  const byToken = new Map<string, Lease>();
  /** invoiceId → its CURRENT lease token (the single-flight index). */
  const byInvoice = new Map<string, string>();
  let seq = 0;

  /** Reclaim leases whose visibility window elapsed (crashed/lost run). */
  function sweep(): void {
    const t = now();
    for (const [token, lease] of [...byToken]) {
      if (lease.expiresAt > t) continue;
      byToken.delete(token);
      if (byInvoice.get(lease.invoiceId) === token) byInvoice.delete(lease.invoiceId);
      log(`queued-invoice source: lease expired for ${lease.invoiceId} (reclaimed)`);
    }
  }

  /** Lease `invoiceId` and mint its handle. Caller guarantees it is free. */
  function lease(invoiceId: string): LeasedHandle<string> {
    seq += 1;
    const token = `${invoiceId}#${seq}`;
    byToken.set(token, { token, invoiceId, expiresAt: now() + ttl });
    byInvoice.set(invoiceId, token);
    // The idempotency key is the invoice's OWN identity, never the lease token:
    // the same invoice redelivered on a later fire must carry the same key.
    return { item: invoiceId, leaseToken: token, idempotencyKey: invoiceId };
  }

  /** A usable, not-already-in-flight queued id. */
  function vendable(id: unknown): id is string {
    return typeof id === "string" && id.length > 0 && !byInvoice.has(id);
  }

  /** Release a lease if `token` is still the current one (fencing). */
  function release(token: string, why: string): void {
    const lease = byToken.get(token);
    if (!lease) return; // stale/expired token — no-op
    byToken.delete(token);
    if (byInvoice.get(lease.invoiceId) === token) byInvoice.delete(lease.invoiceId);
    log(`queued-invoice source: ${why} ${lease.invoiceId}`);
  }

  return {
    async next(n: number, ctx?: WorkSourceContext): Promise<LeasedHandle<string>[]> {
      sweep();
      const cwd = ctx?.cwd;
      // No workspace ⇒ nothing is knowably queued. Vend nothing rather than
      // guess a workspace: a wrong guess would spawn a run against the wrong
      // store. The engine turns an empty vend into a zero-spawn no-op.
      if (!cwd) return [];
      const want = Math.max(0, Math.floor(n));
      if (want === 0) return [];
      const ids = await deps.listQueued(cwd);
      // Excess DEFERS to a later fire (never truncated away); an id already in
      // flight is never re-vended.
      return ids.filter(vendable).slice(0, want).map(lease);
    },

    async take(key: string, _ctx?: WorkSourceContext): Promise<LeasedHandle<string> | null> {
      sweep();
      if (typeof key !== "string" || key.length === 0) return null;
      // Refuse ONLY on a live lease. Queue membership is deliberately NOT
      // re-checked: a targeted request is an explicit operator/UI action, and
      // its run settles on its own empty pick if the record moved on — whereas
      // refusing here would turn a benign race into a user-visible failure.
      if (byInvoice.has(key)) return null;
      return lease(key);
    },

    ack(leaseToken: string): void {
      release(leaseToken, "acked (processed)");
    },

    nack(leaseToken: string): void {
      release(leaseToken, "nacked (returned to pool)");
    },
  };
}
