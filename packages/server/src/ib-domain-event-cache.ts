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
 *
 * Greeting-type frames (`event.eventType === IB_GREETING_EVENT_TYPE`) are the ONE
 * exception to latest-per-key convergence: they form a chronological stream that
 * must survive as long as the session's chat, so they are retained in a bounded,
 * per-session, insertion-ordered log and replayed IN ORDER on connect — never
 * collapsed to their newest entry. See change: restore-assistant-greeting-stream.
 */
import { IB_GREETING_EVENT_TYPE } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** The unchanged live wire frame the plugin server rebroadcasts. */
export interface IbDomainEventFrame {
  type: "ib_domain_event";
  sessionId: string;
  event: { eventType: string; data: unknown };
}

/** One retained greeting: its stable id, its emission-ordering key (epoch-ms,
 *  strictly monotonic across the cache), and the verbatim frame to replay. */
export interface RetainedGreeting {
  id: string;
  order: number;
  frame: IbDomainEventFrame;
}

/** Default hard cap on distinct entity keys (bounds worst-case memory). */
const DEFAULT_MAX_ENTRIES = 500;

/** Default per-session cap on retained greetings (oldest-first eviction). Sized
 *  so a normal invoice lifecycle's greetings are never evicted. */
const DEFAULT_MAX_GREETINGS_PER_SESSION = 50;

/** Derive a greeting's stable id from its payload (`id` or `identity`). Returns
 *  null when neither is present so the caller can synthesize a positional id. */
function greetingIdOf(data: unknown): string | null {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["id", "identity"]) {
      const v = d[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return null;
}

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
  /** Per-session insertion-ordered greeting streams (exempt from `map`). */
  private greetings = new Map<string, RetainedGreeting[]>();
  /** Strictly-monotonic ordering source so equal-ms appends still order stably. */
  private lastOrder = 0;
  private readonly max: number;
  private readonly maxGreetings: number;

  constructor(max: number = DEFAULT_MAX_ENTRIES, maxGreetings: number = DEFAULT_MAX_GREETINGS_PER_SESSION) {
    this.max = Math.max(1, max);
    this.maxGreetings = Math.max(1, maxGreetings);
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

    // Greeting-type frames are EXEMPT from latest-per-key convergence: route
    // them to the ordered per-session stream instead, so a reconnect replays the
    // full chronological stream, not a single collapsed newest frame.
    // See change: restore-assistant-greeting-stream.
    if (eventType === IB_GREETING_EVENT_TYPE) {
      this.appendGreeting(frame);
      return;
    }

    const k = keyOf(eventType, data);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, frame);

    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /**
   * Append a greeting frame to its session's ordered stream. Idempotent by the
   * greeting's stable id: a re-delivered greeting updates the retained frame in
   * place (preserving its original position + ordering key) rather than adding a
   * duplicate. A frame lacking `id`/`identity` gets a synthesized positional id.
   * Bounded per session — oldest greeting evicted first on overflow. Validation
   * mirrors `set`. See change: restore-assistant-greeting-stream.
   */
  appendGreeting(frame: IbDomainEventFrame): void {
    const sessionId = frame?.sessionId;
    const eventType = frame?.event?.eventType;
    const data = frame?.event?.data;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (typeof eventType !== "string" || eventType.length === 0) return;
    if (data === undefined || data === null) return;

    const list = this.greetings.get(sessionId) ?? [];
    const id = greetingIdOf(data) ?? `${sessionId}\u0000${list.length}`;
    const existing = list.find((g) => g.id === id);
    if (existing) {
      existing.frame = frame;
    } else {
      this.lastOrder = Math.max(Date.now(), this.lastOrder + 1);
      list.push({ id, order: this.lastOrder, frame });
      while (list.length > this.maxGreetings) list.shift();
    }
    this.greetings.set(sessionId, list);
  }

  /** Every cached latest frame, oldest-inserted first. */
  getAll(): IbDomainEventFrame[] {
    return Array.from(this.map.values());
  }

  /**
   * The retained greeting stream across all sessions, in global emission order.
   * Replayed on connect (each frame marked `replay: true`) so a mounting or
   * reconnecting browser receives the full ordered stream.
   * See change: restore-assistant-greeting-stream.
   */
  getGreetingsForConnect(): RetainedGreeting[] {
    const all: RetainedGreeting[] = [];
    for (const list of this.greetings.values()) all.push(...list);
    all.sort((a, b) => a.order - b.order);
    return all;
  }

  /** Drop every entry whose originating session matches (called on session death). */
  clearForSession(sessionId: string): void {
    for (const [k, frame] of this.map) {
      if (frame.sessionId === sessionId) this.map.delete(k);
    }
    this.greetings.delete(sessionId);
  }

  /** Test-only: clear the entire cache. */
  reset(): void {
    this.map.clear();
    this.greetings.clear();
    this.lastOrder = 0;
  }
}

/** Module singleton — every call site shares the same cache. */
export const ibDomainEventCache = new IbDomainEventCache();
