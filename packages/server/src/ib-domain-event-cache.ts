/**
 * Server-side cache of the LATEST app-level `ib_domain_event` frame per entity
 * key, so a browser that connects/mounts AFTER an event was broadcast can be
 * replayed the current state and converge — instead of waiting for the next
 * accidental live delta.
 *
 * Mirrors `plugin-intent-cache.ts` (latest-per-key Map + session-scoped purge),
 * adapted to domain events: the envelope is NOT invoice-addressed (the id lives
 * in `event.data`), delivery is global (not a session subscribe), and retention
 * is the latest event per key — never a historical log.
 *
 * See change: replay-invoice-domain-events.
 */

/** The unchanged live wire frame the plugin server rebroadcasts. */
export interface IbDomainEventFrame {
  type: "ib_domain_event";
  sessionId: string;
  event: { eventType: string; data: unknown };
}

/** Default hard cap on distinct entity keys (bounds worst-case memory). */
const DEFAULT_MAX_ENTRIES = 500;

/**
 * Derive the entity id from a frame's payload. The envelope carries no invoice
 * id at the top level; invoice lifecycle events put it in `event.data.invoice_id`,
 * and non-invoice events carry their own id. Falls back to the bare event type so
 * every declared channel still converges to a single latest entry.
 */
function entityIdOf(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["invoice_id", "id", "connector_id", "which"]) {
      const v = d[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return "";
}

function keyOf(eventType: string, data: unknown): string {
  return `${eventType}\u0000${entityIdOf(data)}`;
}

export class IbDomainEventCache {
  private map = new Map<string, IbDomainEventFrame>();
  private readonly max: number;

  constructor(max: number = DEFAULT_MAX_ENTRIES) {
    this.max = Math.max(1, max);
  }

  /**
   * Store the latest frame for its derived key. Malformed frames (missing
   * `sessionId`, `eventType`, or `data`) are skipped. Never throws. Delete-then-set
   * refreshes insertion recency so an updated key is not the next eviction victim;
   * on overflow the oldest-inserted entry is evicted.
   */
  set(frame: IbDomainEventFrame): void {
    const sessionId = frame?.sessionId;
    const eventType = frame?.event?.eventType;
    const data = frame?.event?.data;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (typeof eventType !== "string" || eventType.length === 0) return;
    if (data === undefined || data === null) return;

    const k = keyOf(eventType, data);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, frame);

    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Every cached latest frame, oldest-inserted first. */
  getAll(): IbDomainEventFrame[] {
    return Array.from(this.map.values());
  }

  /** Drop every entry whose originating session matches (called on session death). */
  clearForSession(sessionId: string): void {
    for (const [k, frame] of this.map) {
      if (frame.sessionId === sessionId) this.map.delete(k);
    }
  }

  /** Test-only: clear the entire cache. */
  reset(): void {
    this.map.clear();
  }
}

/** Module singleton — every call site shares the same cache. */
export const ibDomainEventCache = new IbDomainEventCache();
