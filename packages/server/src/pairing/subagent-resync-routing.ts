/**
 * subagent-resync-routing — correlate a resync REPLY back to the browser
 * connection that asked for it, so the reply is delivered requester-scoped
 * instead of fanned out to every subscriber of the session (C5).
 *
 * Why it matters now: with intermediate frames stripped, a mounted inspector
 * pulls the timeline on a cadence. Fanning each fat reply out to N viewers of
 * the same session would multiply exactly the payload this change removed.
 *
 * The correlation token rides on the reply frame (`__resyncRequestId`), echoed
 * by the bridge from the request. Unknown/expired token → undefined, and the
 * caller falls back to the ordinary broadcast, so a lost token degrades to
 * today's behaviour rather than to a dropped reply.
 *
 * See change: reduce-subagent-details-payload.
 */

/** How long an unanswered request stays routable before it is dropped. */
export const RESYNC_REQUEST_TTL_MS = 30_000;

/** Hard cap on pending requests, so a misbehaving client cannot grow this map. */
const DEFAULT_MAX_PENDING = 256;

/** The correlation token a bridge echoes onto its reply frame. */
export function resyncRequestIdOf(data: Record<string, unknown> | undefined): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const id = data.__resyncRequestId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

interface Pending<C> {
  connection: C;
  at: number;
}

/** requestId → the connection awaiting that reply. Bounded and TTL-pruned. */
export class ResyncRequesterRegistry<C> {
  private readonly pending = new Map<string, Pending<C>>();

  constructor(private readonly maxPending = DEFAULT_MAX_PENDING) {}

  get size(): number {
    return this.pending.size;
  }

  /** Remember who asked. Prunes expired entries and enforces the cap. */
  record(requestId: string, connection: C, now: number = Date.now()): void {
    for (const [id, entry] of this.pending) {
      if (now - entry.at > RESYNC_REQUEST_TTL_MS) this.pending.delete(id);
    }
    this.pending.set(requestId, { connection, at: now });
    while (this.pending.size > this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  /**
   * Claim the requester for one reply. Consumes the entry — a duplicate reply
   * falls through to the ordinary broadcast rather than being routed twice.
   */
  take(requestId: string, now: number = Date.now()): C | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    this.pending.delete(requestId);
    return now - entry.at > RESYNC_REQUEST_TTL_MS ? undefined : entry.connection;
  }

  /** Drop every pending request of a connection that went away. */
  forget(connection: C): void {
    for (const [id, entry] of this.pending) {
      if (entry.connection === connection) this.pending.delete(id);
    }
  }
}
