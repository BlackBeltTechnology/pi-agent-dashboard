/**
 * The queued-invoice work source the plugin registers with the automation
 * plugin's generic fan-out seam — plus the in-memory source the FIXTURE engine
 * binding uses.
 *
 * WHO OWNS THE LEASES. The ENGINE does. Its `invoice_leases` table is claimed
 * under `BEGIN IMMEDIATE` with a UNIQUE invoice id, so a claim is fenced ACROSS
 * PROCESSES and survives a restart, and an expired lease is reclaimed by the
 * engine on its next vend. The host must therefore NOT keep a lease map of its
 * own: two lease authorities would race, and the failure mode is precisely the
 * bug this whole relocation removes — two children processing one invoice.
 * `createQueuedInvoiceWorkSource` consequently holds NO lease state; it routes.
 *
 * WHAT IT ROUTES. The engine's source is bound to ONE workspace, while the
 * automation plugin holds ONE source per registered id. The generic seam hands a
 * `WorkSourceContext{cwd}` to each vend, so this wrapper resolves (and caches)
 * the engine source per workspace. `ack`/`nack` carry only a lease token, so the
 * wrapper remembers token→workspace for the tokens it vended. That map is
 * ROUTING, not authority: losing it (process restart) cannot double-process
 * anything — the engine's visibility timeout reclaims the invoice, exactly as it
 * does for a run that died.
 *
 * WHAT THE GUARANTEES REST ON (all of them, now engine-side):
 *   - one leased handle per invoice ⇒ ONE invoice per spawned session, always;
 *   - `next(n)` vends DISTINCT invoices ⇒ concurrent children never share one;
 *   - `take(id)` is refused for an already-leased invoice ⇒ single-flight across
 *     the scheduled drain and a run-this-invoice-now request, in both directions;
 *   - an empty queue vends nothing ⇒ the engine spawns NOTHING (fast-fail);
 *   - excess beyond the bound stays unleased ⇒ deferred to a later fire;
 *   - `done`→ack / anything-else→nack, plus the engine's lease expiry ⇒ an
 *     invoice is never permanently stranded.
 *
 * See change: relocate-fanout-to-work-source.
 */
import { randomUUID } from "node:crypto";
import type { EngineLeasedHandle, EngineWorkSource } from "./engine/port.js";

/** Default lease lifetime for the IN-MEMORY fixture source only (the real engine
 *  owns its own visibility timeout). */
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Per-call context the automation engine supplies: the firing workspace. */
export interface WorkSourceContext {
  cwd: string;
}

/**
 * The plugin-registered source: the shape the automation plugin's seam consumes
 * (`next`/`take` may resolve asynchronously, `ctx` carries the workspace).
 * Structurally mirrors `automation-plugin/src/shared/work-source.ts` — kept
 * duck-typed on purpose: the seam is a RUNTIME service (`ctx.provide` /
 * `ctx.consumeAll`), so a compile-time dependency between two sibling plugins
 * would couple their build graphs for nothing. Keep the two in step.
 */
export interface RegisteredWorkSource {
  next(n: number, ctx?: WorkSourceContext): Promise<EngineLeasedHandle[]>;
  take(key: string, ctx?: WorkSourceContext): Promise<EngineLeasedHandle | null>;
  ack(leaseToken: string): void;
  nack(leaseToken: string): void;
}

export interface QueuedInvoiceSourceDeps {
  /**
   * The engine's workspace-bound source (`engine.queuedWorkSource(cwd)`).
   * `undefined` when the binding has none — fan-out then vends nothing, which is
   * the only safe answer: the host must never mint leases the engine's store
   * does not know about.
   */
  sourceFor: (cwd: string) => EngineWorkSource | undefined;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/**
 * Create the source registered under the engine's `invoicebot-queued` id.
 * Stateless w.r.t. leases (see the module header): it caches one engine source
 * per workspace and routes `ack`/`nack` back to the workspace that vended.
 */
export function createQueuedInvoiceWorkSource(deps: QueuedInvoiceSourceDeps): RegisteredWorkSource {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});
  /** cwd → the engine's source for that workspace (cheap, safe to re-create). */
  const perCwd = new Map<string, EngineWorkSource>();
  /** leaseToken → the cwd that vended it (ROUTING only — never authority). */
  const tokenCwd = new Map<string, string>();

  function sourceFor(cwd: string): EngineWorkSource | undefined {
    const hit = perCwd.get(cwd);
    if (hit) return hit;
    try {
      const src = deps.sourceFor(cwd);
      if (!src) {
        warn(`queued-invoice source unavailable for ${cwd}: engine binding exposes none`);
        return undefined;
      }
      perCwd.set(cwd, src);
      return src;
    } catch (err) {
      warn(`queued-invoice source unavailable for ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  function remember(cwd: string, handles: EngineLeasedHandle[]): void {
    for (const h of handles) {
      // Lease tokens MUST be globally unique for this routing to be sound (the
      // engine mints UUIDs; the fixture source prefixes a per-instance uuid). A
      // collision across workspaces is unroutable, so surface it loudly instead
      // of silently acking the wrong workspace's invoice.
      const prior = tokenCwd.get(h.leaseToken);
      if (prior !== undefined && prior !== cwd) {
        warn(`queued-invoice lease token collision across workspaces (${prior} vs ${cwd}) — release routing is ambiguous`);
      }
      tokenCwd.set(h.leaseToken, cwd);
    }
  }

  /** Resolve the source that vended `leaseToken`, and forget the routing entry. */
  function releaseTarget(leaseToken: string): EngineWorkSource | undefined {
    const cwd = tokenCwd.get(leaseToken);
    if (cwd === undefined) return undefined; // unknown/stale token — a no-op
    tokenCwd.delete(leaseToken);
    return perCwd.get(cwd);
  }

  return {
    async next(n: number, ctx?: WorkSourceContext): Promise<EngineLeasedHandle[]> {
      const cwd = ctx?.cwd;
      // No workspace ⇒ nothing is knowably queued. Vend nothing rather than
      // guess: a wrong guess would lease from (and spawn against) the wrong
      // store. The automation engine turns an empty vend into a zero-spawn no-op.
      if (!cwd) return [];
      const want = Math.max(0, Math.floor(n));
      if (want === 0) return [];
      const src = sourceFor(cwd);
      if (!src) return [];
      const handles = await src.next(want);
      remember(cwd, handles);
      if (handles.length > 0) {
        log(`queued-invoice source leased ${handles.length} invoice(s) for ${cwd}`);
      }
      return handles;
    },

    async take(key: string, ctx?: WorkSourceContext): Promise<EngineLeasedHandle | null> {
      const cwd = ctx?.cwd;
      if (!cwd || typeof key !== "string" || key.length === 0) return null;
      const src = sourceFor(cwd);
      // A binding whose engine cannot lease ONE named invoice exposes no `take`.
      // THROW rather than return null: null means "already leased or gone", which
      // the caller surfaces as an in-flight refusal (HTTP 409), and reporting
      // "already running" for "this engine cannot do it" would send an operator
      // chasing a run that does not exist. Emulating it by leasing others and
      // releasing them is also out — that makes single-flight depend on timing.
      if (!src) throw new Error(`queued-invoice source unavailable for ${cwd}`);
      if (!src.take) {
        throw new Error("engine binding cannot lease a single named invoice (no takeQueued)");
      }
      const handle = await src.take(key);
      if (!handle) {
        log(`queued-invoice ${key}: unavailable (leased or gone)`);
        return null;
      }
      remember(cwd, [handle]);
      return handle;
    },

    ack(leaseToken: string): void {
      const src = releaseTarget(leaseToken);
      if (!src) return;
      try {
        src.ack(leaseToken);
      } catch (err) {
        warn(`queued-invoice ack failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    nack(leaseToken: string): void {
      const src = releaseTarget(leaseToken);
      if (!src) return;
      try {
        src.nack(leaseToken);
      } catch (err) {
        warn(`queued-invoice nack failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

export interface InMemoryQueuedSourceDeps {
  /** Queued invoice ids for the bound workspace. MUST NOT throw. */
  listQueued: () => Promise<string[]>;
  /** Lease lifetime; a lease older than this is reclaimed on the next call. */
  visibilityTimeoutMs?: number;
  now?: () => number;
}

/**
 * An IN-MEMORY queued-invoice source, for the FIXTURE engine binding only.
 *
 * The Fake stands in for the engine wherever the `file:` sibling is absent (CI,
 * a git worktree, `release-cut`), so it must also stand in for the engine's lease
 * store — otherwise fan-out silently does nothing under the Fake and an E2E run
 * looks like a pass. Semantics mirror the engine's source (distinct vend,
 * targeted `take` refused while leased, ack drops, nack returns, stale token is a
 * no-op, expired lease reclaimed) with the one honest difference that leases live
 * in this process, so they are neither cross-process fenced nor restart-durable.
 */
export function createInMemoryQueuedInvoiceSource(deps: InMemoryQueuedSourceDeps): EngineWorkSource {
  const now = deps.now ?? (() => Date.now());
  const ttl =
    deps.visibilityTimeoutMs && deps.visibilityTimeoutMs > 0
      ? deps.visibilityTimeoutMs
      : DEFAULT_VISIBILITY_TIMEOUT_MS;

  const byToken = new Map<string, { token: string; invoiceId: string; expiresAt: number }>();
  const byInvoice = new Map<string, string>();
  // Per-instance prefix: an invoice id can legitimately repeat across workspaces
  // (it is a content hash), and each workspace gets its own source instance, so a
  // bare `<id>#<seq>` token would collide in the host's release routing.
  const instance = randomUUID().slice(0, 8);
  let seq = 0;

  /** Reclaim leases whose visibility window elapsed (crashed/lost run). */
  function sweep(): void {
    const t = now();
    for (const [token, lease] of [...byToken]) {
      if (lease.expiresAt > t) continue;
      byToken.delete(token);
      if (byInvoice.get(lease.invoiceId) === token) byInvoice.delete(lease.invoiceId);
    }
  }

  function lease(invoiceId: string): EngineLeasedHandle {
    seq += 1;
    const token = `${instance}:${invoiceId}#${seq}`;
    byToken.set(token, { token, invoiceId, expiresAt: now() + ttl });
    byInvoice.set(invoiceId, token);
    // The key is the invoice's OWN identity, never the lease token.
    return { item: invoiceId, leaseToken: token, idempotencyKey: invoiceId };
  }

  function release(token: string): void {
    const held = byToken.get(token);
    if (!held) return; // stale/unknown token — fenced no-op
    byToken.delete(token);
    if (byInvoice.get(held.invoiceId) === token) byInvoice.delete(held.invoiceId);
  }

  /** A usable, not-already-in-flight queued id. */
  function vendable(id: unknown): id is string {
    return typeof id === "string" && id.length > 0 && !byInvoice.has(id);
  }

  return {
    async next(n: number): Promise<EngineLeasedHandle[]> {
      sweep();
      const want = Math.max(0, Math.floor(n));
      if (want === 0) return [];
      const ids = await deps.listQueued();
      // Excess DEFERS to a later fire; an id already in flight is never re-vended.
      return ids.filter(vendable).slice(0, want).map(lease);
    },

    async take(invoiceId: string): Promise<EngineLeasedHandle | null> {
      sweep();
      if (typeof invoiceId !== "string" || invoiceId.length === 0) return null;
      // Refuse ONLY on a live lease. Queue membership is deliberately not
      // re-checked: a targeted request is an explicit operator action, and its
      // run settles on its own empty pick if the record moved on.
      if (byInvoice.has(invoiceId)) return null;
      return lease(invoiceId);
    },

    ack(leaseToken: string): void {
      release(leaseToken);
    },

    nack(leaseToken: string): void {
      release(leaseToken);
    },
  };
}
