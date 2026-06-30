/**
 * In-memory event store with LRU eviction.
 * Replaces SQLite-backed event-store.ts.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface StoredEvent {
  seq: number;
  event: DashboardEvent;
}

export interface EventStore {
  /** Insert an event, returns assigned sequence number */
  insertEvent(sessionId: string, event: DashboardEvent): number;
  /** Get events for a session starting from minSeq (inclusive) */
  getEvents(sessionId: string, minSeq: number): StoredEvent[];
  /** Get a single event by sessionId and seq */
  getEvent(sessionId: string, seq: number): DashboardEvent | undefined;
  /**
   * Find the most recent `tool_execution_end` event for a tool call. Pure
   * read; returns undefined when the call is still in flight or its event was
   * evicted under memory pressure. See change: adopt-pi-071-072-073-features.
   */
  findToolEndEvent(sessionId: string, toolCallId: string): DashboardEvent | undefined;
  /** Delete all events for a specific session */
  deleteEventsForSession(sessionId: string): number;
  /** Check if session has events in memory */
  hasEvents(sessionId: string): boolean;
  /** Return the highest seq for a session, or 0 if no events */
  getMaxSeq(sessionId: string): number;
  /** Number of cached sessions */
  sessionCount(): number;
}

interface SessionBuffer {
  events: StoredEvent[];
  nextSeq: number;
  lastAccess: number;
}

export const DEFAULT_MAX_CACHED_SESSIONS = 100;
export const DEFAULT_MAX_EVENTS_PER_SESSION = 5000;

/** Default max size for any string field within event data */
const DEFAULT_MAX_STRING_SIZE = 4_000;
/** Max total serialized size for an individual event's data */
const MAX_EVENT_DATA_SIZE = 20_000;

/**
 * Recursively truncate large string fields in an object.
 * Returns a new object if any truncation occurred, otherwise the original.
 */
function truncateStrings(obj: unknown, maxSize: number, depth = 0): unknown {
  if (depth > 4) return obj;
  if (typeof obj === "string") {
    return obj.length > maxSize ? obj.slice(0, maxSize) + "\n…[truncated]" : obj;
  }
  if (Array.isArray(obj)) {
    // Skip large arrays (e.g., edits arrays)
    if (obj.length > 20) return "[array truncated]";
    let changed = false;
    const result = obj.map((item) => {
      const t = truncateStrings(item, maxSize, depth + 1);
      if (t !== item) changed = true;
      return t;
    });
    return changed ? result : obj;
  }
  if (obj && typeof obj === "object") {
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      // Preserve base64 image data — skip truncation when sibling mimeType exists
      if (key === "data" && typeof val === "string" && "mimeType" in obj) {
        result[key] = val;
        continue;
      }
      // Skip 'thinking' blocks entirely — large and not shown in chat
      if (key === "thinking" && typeof val === "string" && val.length > maxSize) {
        result[key] = (val as string).slice(0, 500) + "\n…[truncated]";
        changed = true;
        continue;
      }
      const t = truncateStrings(val, maxSize, depth + 1);
      if (t !== val) changed = true;
      result[key] = t;
    }
    return changed ? result : obj;
  }
  return obj;
}

/**
 * Truncate large event data to bound memory usage per event.
 */
function createTruncator(maxStringSize: number) {
  if (maxStringSize <= 0) return (event: DashboardEvent) => event; // disabled
  return (event: DashboardEvent): DashboardEvent => {
    const data = event.data;
    if (!data || typeof data !== "object") return event;
    const truncated = truncateStrings(data, maxStringSize) as Record<string, unknown>;
    return truncated !== data ? { ...event, data: truncated } : event;
  };
}

export function createMemoryEventStore(
  isSessionPinned: (sessionId: string) => boolean,
  maxCachedSessions: number = DEFAULT_MAX_CACHED_SESSIONS,
  maxEventsPerSession: number = DEFAULT_MAX_EVENTS_PER_SESSION,
  maxStringFieldSize: number = DEFAULT_MAX_STRING_SIZE,
): EventStore {
  const truncateEventData = createTruncator(maxStringFieldSize);
  const buffers = new Map<string, SessionBuffer>();

  function getOrCreate(sessionId: string): SessionBuffer {
    let buf = buffers.get(sessionId);
    if (!buf) {
      buf = { events: [], nextSeq: 1, lastAccess: Date.now() };
      buffers.set(sessionId, buf);
    }
    buf.lastAccess = Date.now();
    return buf;
  }

  function evictIfNeeded(): void {
    if (buffers.size <= maxCachedSessions) return;

    // Collect evictable sessions sorted by lastAccess ascending
    const evictable: Array<[string, number]> = [];
    for (const [id, buf] of buffers) {
      if (!isSessionPinned(id)) {
        evictable.push([id, buf.lastAccess]);
      }
    }
    evictable.sort((a, b) => a[1] - b[1]);

    // Evict until we're at or below the limit
    let toEvict = buffers.size - maxCachedSessions;
    for (const [id] of evictable) {
      if (toEvict <= 0) break;
      buffers.delete(id);
      toEvict--;
    }
  }

  return {
    insertEvent(sessionId: string, event: DashboardEvent): number {
      const buf = getOrCreate(sessionId);
      const seq = buf.nextSeq++;
      buf.events.push({ seq, event: truncateEventData(event) });
      // Trim oldest events when over the per-session limit (0 = unlimited)
      if (maxEventsPerSession > 0 && buf.events.length > maxEventsPerSession) {
        const excess = buf.events.length - maxEventsPerSession;
        buf.events.splice(0, excess);
      }
      evictIfNeeded();
      return seq;
    },

    getEvents(sessionId: string, minSeq: number): StoredEvent[] {
      const buf = buffers.get(sessionId);
      if (!buf) return [];
      buf.lastAccess = Date.now();
      const effectiveMin = minSeq > 0 ? minSeq : 1;
      return buf.events.filter((e) => e.seq >= effectiveMin);
    },

    getEvent(sessionId: string, seq: number): DashboardEvent | undefined {
      const buf = buffers.get(sessionId);
      if (!buf) return undefined;
      buf.lastAccess = Date.now();
      const entry = buf.events.find((e) => e.seq === seq);
      return entry?.event;
    },

    findToolEndEvent(sessionId: string, toolCallId: string): DashboardEvent | undefined {
      const buf = buffers.get(sessionId);
      if (!buf) return undefined;
      buf.lastAccess = Date.now();
      for (let i = buf.events.length - 1; i >= 0; i--) {
        const ev = buf.events[i].event;
        if (
          ev.eventType === "tool_execution_end" &&
          (ev.data as Record<string, unknown> | undefined)?.toolCallId === toolCallId
        ) {
          return ev;
        }
      }
      return undefined;
    },

    deleteEventsForSession(sessionId: string): number {
      const buf = buffers.get(sessionId);
      if (!buf) return 0;
      const count = buf.events.length;
      buffers.delete(sessionId);
      return count;
    },

    hasEvents(sessionId: string): boolean {
      const buf = buffers.get(sessionId);
      return buf !== undefined && buf.events.length > 0;
    },

    getMaxSeq(sessionId: string): number {
      const buf = buffers.get(sessionId);
      if (!buf || buf.events.length === 0) return 0;
      return buf.events[buf.events.length - 1].seq;
    },

    sessionCount(): number {
      return buffers.size;
    },
  };
}
