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
  /**
   * Cumulative store-shed telemetry (process lifetime, never reset on read).
   * `trimmedEvents` counts per-session-cap drops; `evictedSessions` counts
   * whole-session LRU evictions. See change: instrument-event-store-trim.
   */
  getTrimStats(): TrimStats;
}

export interface TrimStats {
  trimmedEvents: {
    total: number;
    toolExecutionEnd: number;
    bySession: Record<string, number>;
  };
  evictedSessions: number;
}

interface SessionBuffer {
  events: StoredEvent[];
  nextSeq: number;
  lastAccess: number;
}

export const DEFAULT_MAX_CACHED_SESSIONS = 100;
// Raised 5000 → 20000: sessions that run subagents forward every subagent
// lifecycle + inner tool-call/result event into the PARENT session buffer, so a
// single subagent-heavy turn can emit thousands of events and blow the old cap,
// trimming the start of the chat. See change: preserve-chat-head-on-event-trim.
export const DEFAULT_MAX_EVENTS_PER_SESSION = 20000;

/**
 * Event types that carry the visible conversation transcript. The per-session
 * trim NEVER drops these — only the surrounding heavy/ephemeral events
 * (tool_execution_*, subagent_*, flow_*, reasoning, stats_update, streaming
 * message_update deltas). `message_start` + `message_end` are sufficient to
 * rebuild a completed message's text on the client (the finalized content lands
 * at message_end; intermediate `message_update` deltas only matter for the
 * still-streaming tail, which is newest and never trimmed).
 * See change: preserve-chat-head-on-event-trim.
 */
const ESSENTIAL_CHAT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message_start",
  "message_end",
]);

/**
 * Trim `buf.events` down to `cap` in a SINGLE O(n) pass, dropping the oldest
 * NON-essential events first (tool/subagent/flow/reasoning/stats/streaming
 * noise) and only dropping the oldest essential chat events when essentials
 * alone exceed the cap. Reassigns `buf.events`; safe because seq values ride
 * on the surviving entries and `getEvents` filters by seq (gaps are fine).
 * See change: preserve-chat-head-on-event-trim.
 */
function trimBufferToLimit(
  buf: SessionBuffer,
  cap: number,
): { dropped: number; toolEndDropped: number } {
  let toDrop = buf.events.length - cap;
  if (toDrop <= 0) return { dropped: 0, toolEndDropped: 0 };
  const kept: StoredEvent[] = [];
  let dropped = 0;
  let toolEndDropped = 0;
  // Pass 1 (fused into the copy): drop the oldest non-essential entries.
  for (const e of buf.events) {
    if (toDrop > 0 && !ESSENTIAL_CHAT_EVENT_TYPES.has(e.event.eventType)) {
      toDrop--;
      dropped++;
      if (e.event.eventType === "tool_execution_end") toolEndDropped++;
      continue;
    }
    kept.push(e);
  }
  // Pass 2: essentials alone still exceed the cap → drop oldest essentials to
  // hold the memory bound (pathological; cap is 20000 so never hit in practice).
  if (kept.length > cap) {
    dropped += kept.length - cap;
    kept.splice(0, kept.length - cap);
  }
  buf.events = kept;
  return { dropped, toolEndDropped };
}

/** Default max size for any string field within event data */
const DEFAULT_MAX_STRING_SIZE = 4_000;
/**
 * Default cap on the TOTAL serialized size of an individual event's `data`
 * (bytes). A single subagent turn embeds its full timeline (tool calls,
 * reasoning, assistant text) into ONE forwarded event; without this ceiling a
 * deeply-nested payload can escape per-field truncation and blow the server
 * heap when `JSON.stringify`d on the broadcast path (whole-server OOM).
 * See change: bound-subagent-event-serialization.
 */
export const DEFAULT_MAX_EVENT_DATA_SIZE = 20_000;

/** True for a base64 image content block (`data` string + sibling `mimeType`). */
function isImageBlock(obj: object): boolean {
  return (
    typeof (obj as Record<string, unknown>).data === "string" &&
    "mimeType" in obj
  );
}

/**
 * Anchored match of a `/skill:<name>` invocation envelope
 * (`<skill name=".." location="..">\nbody\n</skill>[\n\nargs]`) — the shape
 * pi's `_expandSkillCommand` + the bridge's prompt-expander emit as the USER
 * message content. Mirrors `skill-block-parser.ts` (`SKILL_BLOCK_RE`).
 */
const SKILL_ENVELOPE_RE =
  /^(<skill name="[^"]+" location="[^"]+">\n)([\s\S]*?)(\n<\/skill>)((?:\n\n[\s\S]+)?)$/;

/** Cap a string to `maxSize`, appending a truncation marker when trimmed. */
function capString(s: string, maxSize: number): string {
  if (s.length <= maxSize) return s;
  // Skill invocation envelope: naive mid-string truncation would sever the
  // closing </skill> tag, making the client's parseSkillBlock return null —
  // the message then renders as a wall of raw pseudo-HTML (or nothing).
  // Truncate the BODY only, keeping header + closing tag + trailing args
  // intact so the envelope stays well-formed and parseable.
  // See change: bound-subagent-event-serialization (skill regression fix).
  const skill = s.match(SKILL_ENVELOPE_RE);
  if (skill) {
    const [, header, body, closer, args] = skill;
    const overhead = header.length + closer.length + args.length;
    const budget = Math.max(0, maxSize - overhead);
    if (body.length > budget) {
      return `${header}${body.slice(0, budget)}\n…[truncated]${closer}${args}`;
    }
    return s; // over maxSize only due to envelope overhead — leave intact
  }
  return `${s.slice(0, maxSize)}\n…[truncated]`;
}

/**
 * Handle a value that sits BEYOND the recursion depth limit. Never returns the
 * sub-tree raw — that let deeply-nested subagent payloads smuggle unbounded
 * data past truncation. Strings are capped; containers collapse to a bounded
 * marker; base64 image blocks are preserved.
 * See change: bound-subagent-event-serialization.
 */
function summarizeAtDepthLimit(obj: unknown, maxSize: number): unknown {
  if (typeof obj === "string") return capString(obj, maxSize);
  if (obj && typeof obj === "object") {
    if (!Array.isArray(obj) && isImageBlock(obj)) return obj;
    return "[truncated: deep]";
  }
  return obj;
}

/**
 * Recursively truncate large string fields in an object.
 * Returns a new object if any truncation occurred, otherwise the original.
 */
function truncateStrings(obj: unknown, maxSize: number, depth = 0): unknown {
  if (depth > 4) return summarizeAtDepthLimit(obj, maxSize);
  if (typeof obj === "string") return capString(obj, maxSize);
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
        result[key] = `${(val as string).slice(0, 500)}\n…[truncated]`;
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
 * Bounded-cost check: does `value` serialize to more than `cap` bytes?
 * Early-exits the moment the running estimate crosses `cap`, so it NEVER
 * materializes the full serialization (that allocation is exactly the OOM we
 * are guarding against). Worst-case cost is O(cap), not O(payload).
 * The estimate approximates JSON byte length (ignores escape expansion); it is
 * a guard threshold, not an exact size. See change:
 * bound-subagent-event-serialization.
 */
interface SizeWalk {
  total: number;
  cap: number;
  seen: WeakSet<object>;
}

/** Accumulate an array's approximate JSON size; early-exit once over cap. */
function walkArraySize(arr: unknown[], w: SizeWalk): boolean {
  w.total += 2; // []
  for (const item of arr) {
    if (walkSize(item, w)) return true;
    w.total += 1; // comma
  }
  return w.total > w.cap;
}

/** Accumulate an object's approximate JSON size; early-exit once over cap. */
function walkObjectSize(obj: Record<string, unknown>, w: SizeWalk): boolean {
  w.total += 2; // {}
  // Preserved base64 image blocks (`data` string + sibling `mimeType`) are
  // deliberately exempt from string truncation, so their bytes must not count
  // toward the per-event ceiling either — otherwise ANY user message with a
  // pasted image (> cap base64) collapses to the {__truncated} placeholder and
  // vanishes from chat. Count a small constant instead of the raw bytes.
  // See change: bound-subagent-event-serialization (image regression fix).
  const imageBlock = isImageBlock(obj);
  for (const k of Object.keys(obj)) {
    w.total += k.length + 3; // "k":
    if (w.total > w.cap) return true;
    if (imageBlock && k === "data" && typeof obj[k] === "string") {
      w.total += 8; // stand-in for the preserved base64 payload
      if (w.total > w.cap) return true;
      continue;
    }
    if (walkSize(obj[k], w)) return true;
    w.total += 1; // comma
  }
  return w.total > w.cap;
}

/** Add `v`'s approximate JSON size to `w.total`; return true once over cap. */
function walkSize(v: unknown, w: SizeWalk): boolean {
  if (w.total > w.cap) return true;
  switch (typeof v) {
    case "string":
      w.total += v.length + 2; // surrounding quotes
      return w.total > w.cap;
    case "number":
    case "boolean":
      w.total += 8;
      return w.total > w.cap;
    case "object":
      break; // handled below
    default:
      return w.total > w.cap; // undefined / function → omitted by JSON
  }
  if (v === null) {
    w.total += 4;
    return w.total > w.cap;
  }
  if (w.seen.has(v)) {
    w.total += 2;
    return w.total > w.cap;
  }
  w.seen.add(v);
  return Array.isArray(v)
    ? walkArraySize(v, w)
    : walkObjectSize(v as Record<string, unknown>, w);
}

export function exceedsSerializedSize(value: unknown, cap: number): boolean {
  return walkSize(value, { total: 0, cap, seen: new WeakSet<object>() });
}

/**
 * Truncate large event data to bound memory usage per event. Applies a
 * per-field string cap (`maxStringSize`) and then a hard per-event total-size
 * ceiling (`maxEventDataSize`); an over-ceiling event's data is replaced with a
 * bounded placeholder so it can never OOM the persist/broadcast path.
 */
function createTruncator(maxStringSize: number, maxEventDataSize: number) {
  const stringPass = maxStringSize > 0;
  const sizePass = maxEventDataSize > 0;
  if (!stringPass && !sizePass) return (event: DashboardEvent) => event; // disabled
  return (event: DashboardEvent): DashboardEvent => {
    const data = event.data;
    if (!data || typeof data !== "object") return event;
    const truncated = stringPass
      ? (truncateStrings(data, maxStringSize) as Record<string, unknown>)
      : (data as Record<string, unknown>);
    if (sizePass && exceedsSerializedSize(truncated, maxEventDataSize)) {
      return {
        ...event,
        data: {
          __truncated: true,
          reason: "event data exceeded MAX_EVENT_DATA_SIZE",
          thresholdBytes: maxEventDataSize,
          eventType: event.eventType,
        },
      };
    }
    return truncated !== data ? { ...event, data: truncated } : event;
  };
}

export function createMemoryEventStore(
  isSessionPinned: (sessionId: string) => boolean,
  maxCachedSessions: number = DEFAULT_MAX_CACHED_SESSIONS,
  maxEventsPerSession: number = DEFAULT_MAX_EVENTS_PER_SESSION,
  maxStringFieldSize: number = DEFAULT_MAX_STRING_SIZE,
  maxEventDataSize: number = DEFAULT_MAX_EVENT_DATA_SIZE,
): EventStore {
  const truncateEventData = createTruncator(maxStringFieldSize, maxEventDataSize);
  const buffers = new Map<string, SessionBuffer>();
  // Overshoot allowed before a reclaim pass runs. Scales to 0 for the tiny
  // caps used in unit tests (so they trim on every over-cap insert, exercising
  // the exact-cap behavior) and to 256 for the 20000 production cap (~1 pass
  // per 256 inserts). See change: preserve-chat-head-on-event-trim.
  const trimSlack = Math.min(256, Math.floor(maxEventsPerSession * 0.05));

  // Cumulative store-shed counters (process lifetime, never reset on read).
  // Mirrors browserGateway's droppedFramesTotal shape. Answers "does trim/evict
  // ever fire, and does trim ever hit a terminal tool_execution_end."
  // See change: instrument-event-store-trim.
  let trimmedEventsTotal = 0;
  let trimmedToolEndTotal = 0;
  // Per-session trim tally. Lifecycle-scoped: the entry is dropped whenever its
  // session buffer is removed (LRU evict / explicit delete), so the Map cannot
  // accumulate stale sessions over process lifetime. The cumulative global
  // counters above are the lifetime record. See change: instrument-event-store-trim.
  const trimmedEventsBySession = new Map<string, number>();
  let evictedSessionsTotal = 0;

  function getOrCreate(sessionId: string): SessionBuffer {
    let buf = buffers.get(sessionId);
    if (!buf) {
      buf = { events: [], nextSeq: 1, lastAccess: Date.now() };
      buffers.set(sessionId, buf);
    }
    buf.lastAccess = Date.now();
    return buf;
  }

  function evictIfNeeded(): number {
    if (buffers.size <= maxCachedSessions) return 0;

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
    let evicted = 0;
    for (const [id] of evictable) {
      if (toEvict <= 0) break;
      buffers.delete(id);
      trimmedEventsBySession.delete(id);
      toEvict--;
      evicted++;
    }
    return evicted;
  }

  return {
    insertEvent(sessionId: string, event: DashboardEvent): number {
      const buf = getOrCreate(sessionId);
      const seq = buf.nextSeq++;
      buf.events.push({ seq, event: truncateEventData(event) });
      // Trim over the per-session limit (0 = unlimited). Hysteresis: only
      // reclaim once the buffer overshoots the cap by TRIM_SLACK, then trim
      // back to the cap in one O(n) pass. This amortizes the trim cost to O(1)
      // per insert (vs O(n) per insert if we trimmed on every over-cap insert)
      // — critical because the history-load path inserts every replayed event
      // through here in a loop, and subagent floods emit thousands at the cap.
      // The pass preserves the chat head (message_start/end) and drops the
      // oldest tool/subagent/flow noise first. See change:
      // preserve-chat-head-on-event-trim.
      if (
        maxEventsPerSession > 0 &&
        buf.events.length > maxEventsPerSession + trimSlack
      ) {
        const { dropped, toolEndDropped } = trimBufferToLimit(buf, maxEventsPerSession);
        if (dropped > 0) {
          trimmedEventsTotal += dropped;
          trimmedToolEndTotal += toolEndDropped;
          trimmedEventsBySession.set(
            sessionId,
            (trimmedEventsBySession.get(sessionId) ?? 0) + dropped,
          );
        }
      }
      evictedSessionsTotal += evictIfNeeded();
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
      trimmedEventsBySession.delete(sessionId);
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

    getTrimStats(): TrimStats {
      return {
        trimmedEvents: {
          total: trimmedEventsTotal,
          toolExecutionEnd: trimmedToolEndTotal,
          bySession: Object.fromEntries(trimmedEventsBySession),
        },
        evictedSessions: evictedSessionsTotal,
      };
    },
  };
}
