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
   * whole-session LRU evictions; `collapsedUpdates` counts superseded
   * `tool_execution_update` events dropped at retention.
   * See change: instrument-event-store-trim, collapse-superseded-tool-execution-updates.
   */
  getTrimStats(): TrimStats;
  /**
   * TEST-ONLY instrumentation for the collapse find-cost bound (D6). Distinct
   * from the `collapsedUpdates` telemetry counter: this answers "how many
   * buffer entries did the predecessor lookup examine", not "how many events
   * were shed". See change: collapse-superseded-tool-execution-updates (P1).
   */
  getCollapseProbe(): CollapseProbe;
}

export interface TrimStats {
  trimmedEvents: {
    total: number;
    toolExecutionEnd: number;
    bySession: Record<string, number>;
  };
  evictedSessions: number;
  /**
   * Cumulative count of superseded `tool_execution_update` events removed by
   * the retention collapse. ADDITIVE `/api/health` field.
   * See change: collapse-superseded-tool-execution-updates (D9).
   */
  collapsedUpdates: number;
}

/**
 * All-zero `TrimStats`, used as `/api/health`'s fallback when no event store is
 * wired. Exported (rather than written as a literal at the call site) because
 * TypeScript types `a ?? b` as `NonNullable<A> | B` and does NOT check `b`
 * against `A` — an inline literal would silently omit a newly-required field
 * while still typechecking. Naming the type here makes the omission a compile
 * error and gives the shape test something to assert against.
 * See change: collapse-superseded-tool-execution-updates (D9).
 */
export const EMPTY_TRIM_STATS: TrimStats = {
  trimmedEvents: { total: 0, toolExecutionEnd: 0, bySession: {} },
  evictedSessions: 0,
  collapsedUpdates: 0,
};

export interface CollapseProbe {
  /** Buffer entries examined by the most recent insert's predecessor lookup. */
  lastEntriesExamined: number;
  /** High-water mark of `lastEntriesExamined` over the store's lifetime. */
  maxEntriesExamined: number;
  /** Live total of indexed `toolCallId`s across every resident buffer. */
  indexedToolCalls: number;
}

/**
 * Two INDEPENDENT seq pointers per `toolCallId` (D7). `creatingSeq` pins the
 * first update carrying `details.agentId` (first-wins `type`/`description`);
 * `newestSeq` tracks the current retained tail update. A single-seq index
 * would collapse the creating tick whenever it happened to be the indexed
 * predecessor, silently voiding the pin.
 */
interface CollapseIndexEntry {
  creatingSeq: number | undefined;
  newestSeq: number | undefined;
}

interface SessionBuffer {
  events: StoredEvent[];
  nextSeq: number;
  lastAccess: number;
  /**
   * Per-buffer collapse index, keyed by `toolCallId` and holding SEQ values —
   * never array positions (`trimBufferToLimit` rebuilds the array wholesale,
   * invalidating any position). Lives on the buffer so it is released with it
   * on LRU evict / `deleteEventsForSession`; a process-wide map would
   * accumulate an entry per `toolCallId` of every evicted session — an
   * unbounded leak inside a memory-bounding change (D6.4).
   */
  collapseIndex: Map<string, CollapseIndexEntry>;
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
  // Inline terminal lifecycle: the reducer's card position depends on the
  // paired open/close surviving trim together. Trimming one of a structurally
  // paired set relocates the card to the stream tail on replay.
  // See change: preserve-inline-terminal-transcript (D3b).
  "inline_terminal_open",
  "inline_terminal_close",
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

// ---- Superseded `tool_execution_update` collapse (D5/D6/D7) ----
// See change: collapse-superseded-tool-execution-updates.

/**
 * Resolve an update's subagent `details` as `data.partialResult.details` ONLY.
 * Mirrors the client reducer exactly: its `tool_execution_update` branch gates
 * on `if (partialResult)` and reads `structured.details`; it NEVER falls back
 * to a top-level `data.details` for an update (that path belongs to
 * `tool_execution_end`). A gate resolving `data.details` would compare keys the
 * consumer never reads, and could drop a predecessor on the strength of a field
 * that has no effect (D7.1).
 */
function resolveUpdateDetails(event: DashboardEvent): Record<string, unknown> | undefined {
  const data = event.data as Record<string, unknown> | undefined;
  const pr = data?.partialResult as Record<string, unknown> | undefined;
  if (!pr || typeof pr !== "object") return undefined;
  const details = pr.details;
  if (!details || typeof details !== "object") return undefined;
  return details as Record<string, unknown>;
}

/**
 * Does this update set the consumer's rendered `result`? `result` has TWO
 * sources, not one: the plain-string `partialResult` branch, and the structured
 * branch's text extracted from `partialResult.content` (a SIBLING of `details`,
 * assigned only `if (text != null)`). Expressed over the OUTCOME using the
 * reducer's own predicate rather than over the presence of a `content` key,
 * so the mixed plain-string → structured-without-`content` case is caught (D7).
 */
function setsRenderedResult(event: DashboardEvent): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  const pr = data?.partialResult;
  if (pr == null) return false;
  if (typeof pr !== "object") return true; // plain-string overwrite branch
  const content = (pr as Record<string, unknown>).content;
  // Reducer: array-with-text → that text; else `content != null` → String(content).
  return content != null;
}

/** Coarse JS value type, distinguishing null and array from plain objects. */
function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * D7 superset gate: may predecessor `p` be dropped in favour of successor `s`?
 *
 * The reducer's `subagents` merge is ACCUMULATIVE — every field is extracted
 * conditionally, so a field present in `p` and absent from `s` survives the
 * full fold and would be lost by a naive keep-newest. Require ALL of:
 *   - every key of `p`'s details is present in `s`'s details AND holds the same
 *     JS type (`readSubagentDetails` extracts type-conditionally, so a key that
 *     is present-but-type-downgraded is "absent" to the consumer);
 *   - a non-empty `entries` is not replaced by an empty/absent one (the
 *     reducer's empty-array overwrite guard exists because initial and
 *     late/reordered frames legitimately arrive empty);
 *   - if `p` sets the rendered `result`, `s` sets it too.
 * Neither carrying details ⇒ the plain-string overwrite branch ⇒ unconditional.
 * On failure BOTH are retained; the index advances to `s`, so the non-subsumed
 * `p` is shed only by the ordinary trim/evict policies.
 */
/** Is every key of `pd` present in `sd` holding a value of the SAME JS type? */
function keysSurvive(pd: Record<string, unknown>, sd: Record<string, unknown>): boolean {
  for (const k of Object.keys(pd)) {
    if (!(k in sd)) return false;
    if (valueType(pd[k]) !== valueType(sd[k])) return false;
  }
  return true;
}

/** Is a non-empty `entries` array preserved (never replaced by an empty one)? */
function entriesSurvive(pd: Record<string, unknown>, sd: Record<string, unknown>): boolean {
  if (!Array.isArray(pd.entries) || pd.entries.length === 0) return true;
  return Array.isArray(sd.entries) && sd.entries.length > 0;
}

function subsumes(p: DashboardEvent, s: DashboardEvent): boolean {
  const dp = resolveUpdateDetails(p);
  const ds = resolveUpdateDetails(s);
  if (!dp && !ds) return true;
  const pd = dp ?? {};
  const sd = ds ?? {};
  if (!keysSurvive(pd, sd)) return false;
  if (!entriesSurvive(pd, sd)) return false;
  return !setsRenderedResult(p) || setsRenderedResult(s);
}

/** `data.toolCallId` when it is a string — else undefined (D5 fail-open). */
function readToolCallId(event: DashboardEvent): string | undefined {
  const id = (event.data as Record<string, unknown> | undefined)?.toolCallId;
  return typeof id === "string" ? id : undefined;
}

/**
 * Default max size for any string field within event data. Exported so the
 * boot-time transcript-cap assert can validate the value the store ACTUALLY
 * uses when the config leaves it unset, rather than skipping the check.
 * See change: fit-attachments-for-display (task 5.5).
 */
export const DEFAULT_MAX_STRING_SIZE = 4_000;
/**
 * Default cap on the TOTAL serialized size of an individual event's `data`
 * (bytes). A single subagent turn embeds its full timeline (tool calls,
 * reasoning, assistant text) into ONE forwarded event; without this ceiling a
 * deeply-nested payload can escape per-field truncation and blow the server
 * heap when `JSON.stringify`d on the broadcast path (whole-server OOM).
 * See change: bound-subagent-event-serialization.
 *
 * Raised 20_000 -> 262_144 (256 KiB). Image content blocks are now fitted for
 * display BEFORE they reach the store (768 px long edge, q75), whose measured
 * worst case is 212 KB (n=40) - so 256 KiB covers 100 % of fitted output and
 * the ceiling becomes deterministic. At the RAW payload sizes that reach the
 * store today (p99 2.2 MB, max 10.5 MB) a 256 KiB ceiling would still only
 * cover 74.9 %, which is why the raise is only sound TOGETHER with the fit.
 * The raise is global: `DEFAULT_TRANSCRIPT_CAP_BYTES` is derived from it at
 * 0.75 x and therefore moves 15 KB -> 192 KiB (D9, accepted).
 * See change: fit-attachments-for-display (task 5.4, D2/D9).
 */
export const DEFAULT_MAX_EVENT_DATA_SIZE = 262_144;

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

/**
 * Cap a string to `maxSize`, keeping BOTH its head and tail when trimmed.
 * The generic branch keeps `floor(maxSize/2)` head + the remaining tail joined
 * by a `\n…[N chars hidden]…\n` marker (N = original length − kept) — a 50/50
 * split, the safe universal across tool outputs and errors. Exported so the
 * subagent reducer can cap individual entry leaves.
 * See change: head-tail-truncate-subagent-event-timeline (D2).
 */
export function capString(s: string, maxSize: number): string {
  if (s.length <= maxSize) return s;
  // Skill invocation envelope: naive mid-string truncation would sever the
  // closing </skill> tag, making the client's parseSkillBlock return null —
  // the message then renders as a wall of raw pseudo-HTML (or nothing).
  // Truncate the BODY only, keeping header + closing tag + trailing args
  // intact so the envelope stays well-formed and parseable. This branch stays
  // HEAD-ONLY on the body: head+tail on a skill body risks the client
  // parseSkillBlock contract, and the branch already bounds the body while
  // keeping the closing tag.
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
  const head = Math.floor(maxSize / 2);
  const tail = maxSize - head;
  const hidden = s.length - maxSize;
  return `${s.slice(0, head)}\n…[${hidden} chars hidden]…\n${s.slice(s.length - tail)}`;
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
 * Byte-accurate JSON-serialized length of a string (UTF-8 width + escape
 * expansion), INCLUDING the two surrounding quotes. Only called on strings
 * whose code-unit length is already known to be within the remaining budget
 * (the caller short-circuits huge strings via the code-unit lower bound), so
 * this scan is bounded by `cap`, never by the raw payload size.
 * See change: head-tail-truncate-subagent-event-timeline (D8).
 */
function jsonStringByteSize(s: string): number {
  let n = 2; // surrounding quotes
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) {
      n += 2; // \" or \\
    } else if (c < 0x20) {
      // \b \t \n \f \r escape to 2 chars; other control chars to \u00XX (6).
      n += c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : 6;
    } else if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: a valid pair (one 4-byte UTF-8 sequence) ONLY when a low
      // surrogate follows; otherwise ES2019+ JSON.stringify escapes the lone
      // surrogate as \uXXXX (6 bytes) — count 6 so we never undercount.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 6;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      n += 6; // lone low surrogate → \uXXXX
    } else {
      n += 3;
    }
  }
  return n;
}

/**
 * Bounded-cost check: does `value` serialize to more than `cap` bytes?
 * Early-exits the moment the running estimate crosses `cap`, so it NEVER
 * materializes the full serialization (that allocation is exactly the OOM we
 * are guarding against). Worst-case cost is O(cap), not O(payload).
 * The walk is BYTE-ACCURATE: each string counts its actual JSON byte length
 * (UTF-8 + escapes) and a base64 image `data` counts at its REAL size, so the
 * ceiling holds in actual bytes for escape/CJK/image-heavy input. A huge string
 * is short-circuited via its code-unit lower bound (UTF-8 bytes ≥ UTF-16 units)
 * so it is never scanned. See change: head-tail-truncate-subagent-event-timeline (D8).
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
  // A base64 image `data` string used to be exempt (counted as 8 bytes), which
  // let a multi-megabyte image escape the ceiling and then OOM the broadcast
  // `JSON.stringify`. It now counts at its REAL byte size like any other string
  // (short-circuited via the code-unit lower bound when huge).
  // See change: head-tail-truncate-subagent-event-timeline (D8).
  for (const k of Object.keys(obj)) {
    w.total += k.length + 3; // "k":
    if (w.total > w.cap) return true;
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
      // Code-unit lower bound: UTF-8 bytes ≥ UTF-16 code units. If even the
      // lower bound crosses the cap, the actual byte count does too — short
      // out WITHOUT scanning the (possibly multi-megabyte) string.
      if (w.total + v.length > w.cap) {
        w.total += v.length + 2;
        return true;
      }
      w.total += jsonStringByteSize(v);
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
 * Byte-accurate, BOUNDED serialized-size measurement. Returns the exact JSON
 * byte length when `value` fits within `cap`, else `cap + 1` (an over-ceiling
 * sentinel) — the walk early-exits and NEVER materializes a full
 * `JSON.stringify`. Used by the subagent reducer for both the entries budget
 * `E` and the terminal bound proof, and per-entry by the shrink loop.
 * See change: head-tail-truncate-subagent-event-timeline (D8).
 */
export function measureBytes(value: unknown, cap: number): number {
  const w: SizeWalk = { total: 0, cap, seen: new WeakSet<object>() };
  walkSize(value, w);
  return Math.min(w.total, cap + 1);
}

// ---- Subagent-timeline head+tail reduction ----
// See change: head-tail-truncate-subagent-event-timeline.

/** Non-`entries` string caps (D3/D7). */
const PROMPT_CAP = 2_000;
const DESC_CAP = 1_500;
const CONTENT_CAP = 1_500;
/** Head/tail entry retention + per-ENTRY byte-budget floors (D3). */
const K_HEAD = 1;
const K_TAIL = 4;
const MID_FLOOR = 800;
const ENTRY_FLOOR = 256;
/** Reserve for the sentinel entry + per-field `…hidden…` markers (D3). */
const MARKER_RESERVE = 300;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

interface SubagentTimeline {
  /** The resolved `details` object carrying `entries[]` (+ `description`). */
  details: Record<string, unknown>;
  /** The `entries[]` array reachable on `details`. */
  entries: unknown[];
  /** Whether `details` sits under `data.partialResult` (live) vs `data`. */
  underPartialResult: boolean;
}

/**
 * TYPE-scoped detector (D1). Returns the resolved `details` + its `entries[]`
 * ONLY when the event is a subagent-carrying tool event — `data.toolName ===
 * "Agent"`, OR eventType `tool_execution_update`/`tool_execution_end` with a
 * `details.agentId` — AND an array sits at `data.partialResult.details.entries`
 * (live) or `data.details.entries` (started/end). Shape alone (a bare array)
 * MUST NOT match.
 */
function locateSubagentTimeline(event: DashboardEvent): SubagentTimeline | undefined {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return undefined;
  const pr = data.partialResult as Record<string, unknown> | undefined;
  let details: Record<string, unknown> | undefined;
  let underPartialResult = false;
  if (pr && typeof pr === "object" && pr.details && typeof pr.details === "object") {
    details = pr.details as Record<string, unknown>;
    underPartialResult = true;
  } else if (data.details && typeof data.details === "object") {
    details = data.details as Record<string, unknown>;
  }
  if (!details || !Array.isArray(details.entries)) return undefined;
  const isAgentTool = data.toolName === "Agent";
  const isUpdateOrEnd =
    event.eventType === "tool_execution_update" || event.eventType === "tool_execution_end";
  const hasAgentId = typeof details.agentId === "string";
  if (!isAgentTool && !(isUpdateOrEnd && hasAgentId)) return undefined;
  return { details, entries: details.entries as unknown[], underPartialResult };
}

/** Head+tail-cap every string reachable inside `content[*]`, recursing container blocks. */
function capContentBlocks(blocks: unknown[], cap: number): void {
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    if (typeof block.text === "string") block.text = capString(block.text, cap);
    // Base64 image `data` is capped too — no image preservation on this path.
    if (typeof block.data === "string") block.data = capString(block.data, cap);
    if (Array.isArray(block.content)) capContentBlocks(block.content, cap);
  }
}

/**
 * Step 0 (D3): head+tail-cap ALL big non-`entries` strings on the CLONE —
 * `args.prompt`, `details.description`, and every string inside
 * `partialResult.content[*]` (both `.text` and image `.data`). After this no
 * non-`entries` string exceeds its cap, so the envelope is provably bounded.
 */
function capLargeStrings(data: Record<string, unknown>, details: Record<string, unknown>): void {
  const args = data.args as Record<string, unknown> | undefined;
  if (args && typeof args.prompt === "string") args.prompt = capString(args.prompt, PROMPT_CAP);
  if (typeof details.description === "string") {
    details.description = capString(details.description, DESC_CAP);
  }
  const pr = data.partialResult as Record<string, unknown> | undefined;
  if (pr && Array.isArray(pr.content)) capContentBlocks(pr.content, CONTENT_CAP);
}

interface LeafRef {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
  value: string;
}

/** One bounded walk returning the entry's CURRENTLY-largest string leaf, if any. */
function findLargestStringLeaf(root: unknown): LeafRef | undefined {
  let best: LeafRef | undefined;
  const seen = new WeakSet<object>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === "string") {
          if (!best || v.length > best.value.length) best = { parent: node, key: i, value: v };
        } else if (v && typeof v === "object") {
          stack.push(v);
        }
      }
    } else {
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string") {
          if (!best || v.length > best.value.length) best = { parent: obj, key: k, value: v };
        } else if (v && typeof v === "object") {
          stack.push(v);
        }
      }
    }
  }
  return best;
}

/**
 * D3a: shrink one entry to a byte budget `B` by repeatedly head+tail-capping its
 * CURRENTLY-largest string leaf at a shrinking cap, down to `ENTRY_FLOOR`. Bounds
 * the ENTRY total regardless of leaf count and caps base64 leaves inside entries
 * — never relies on a per-leaf `maxSize`. Mutates the (already-cloned) entry.
 */
export function shrinkEntryToBudget(entry: unknown, B: number): unknown {
  if (!entry || typeof entry !== "object") return entry;
  let guard = 0;
  while (measureBytes(entry, B) > B && guard < 100_000) {
    guard++;
    const leaf = findLargestStringLeaf(entry);
    if (!leaf || leaf.value.length <= ENTRY_FLOOR) break;
    const newCap = Math.max(ENTRY_FLOOR, Math.floor(leaf.value.length / 2));
    (leaf.parent as Record<string | number, unknown>)[leaf.key] = capString(leaf.value, newCap);
  }
  return entry;
}

/** Byte-bounded `{ __truncated }` placeholder built WITHOUT stringifying the original. */
function truncatedPlaceholder(event: DashboardEvent, maxEventDataSize: number): DashboardEvent {
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

function entryTs(entry: unknown): number {
  if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).ts === "number") {
    return (entry as Record<string, unknown>).ts as number;
  }
  return Date.now();
}

/**
 * D3: reduce an over-ceiling subagent-timeline event, tail-weighted and
 * final-protected, to `≤ ceiling` ACTUAL bytes. Returns a NEW event with the
 * touched spine (`data`, `data.args`, resolved `details`, `details.entries`)
 * cloned — NEVER mutates the in-flight `event`. Falls back to `{ __truncated }`
 * when the event is unreducible (e.g. empty `entries[]` + oversized envelope).
 * No `JSON.stringify` anywhere — all measurement is via `measureBytes`.
 */
export function reduceSubagentEvent(event: DashboardEvent, ceiling: number): DashboardEvent {
  const origData = event.data as Record<string, unknown>;
  const data: Record<string, unknown> = { ...origData };
  if (data.args && typeof data.args === "object") data.args = { ...(data.args as object) };

  // Resolve + clone the details spine on the CLONE.
  const loc = locateSubagentTimeline(event);
  if (!loc) return event; // defensive — caller only routes detected events
  let details: Record<string, unknown>;
  if (loc.underPartialResult) {
    const prClone = { ...(data.partialResult as Record<string, unknown>) };
    if (Array.isArray(prClone.content)) prClone.content = structuredClone(prClone.content);
    details = { ...(prClone.details as object) } as Record<string, unknown>;
    prClone.details = details;
    data.partialResult = prClone;
  } else {
    details = { ...(data.details as object) } as Record<string, unknown>;
    data.details = details;
  }
  const origEntries = loc.entries;

  // Step 0: cap all big non-`entries` strings.
  capLargeStrings(data, details);

  // Compute the envelope budget with entries removed.
  details.entries = [];
  const envBytes = measureBytes(data, ceiling);
  const E = ceiling - envBytes - MARKER_RESERVE;
  const ENTRY_FINAL = clamp(Math.round(E * 0.45), 1_500, 6_000);

  const n = origEntries.length;
  const kHead = Math.min(K_HEAD, n);
  let kTail = Math.min(K_TAIL, n - kHead);

  // Decrement K_TAIL while the intermediate per-entry budget underflows MID_FLOOR.
  while (kHead + kTail > 1) {
    const kept = kHead + kTail;
    const entryMid = (E - ENTRY_FINAL) / (kept - 1);
    if (entryMid >= MID_FLOOR) break;
    if (kTail > 1) kTail--;
    else break;
  }
  const kept = kHead + kTail;
  const ENTRY_MID = kept > 1 ? Math.max(ENTRY_FLOOR, Math.floor((E - ENTRY_FINAL) / (kept - 1))) : E;

  // Build kept real entries (cloned) + a text sentinel for the dropped middle.
  const head = origEntries.slice(0, kHead).map((e) => structuredClone(e));
  const tail = kTail > 0 ? origEntries.slice(n - kTail).map((e) => structuredClone(e)) : [];
  const keptReal = [...head, ...tail];
  const hiddenCount = n - kHead - kTail;
  const display: unknown[] = [...head];
  if (hiddenCount > 0) {
    display.push({
      kind: "text",
      text: `⋯ ${hiddenCount} steps hidden ⋯`,
      ts: entryTs(origEntries[kHead]),
    });
  }
  display.push(...tail);

  // Shrink intermediate entries to ENTRY_MID, then the final entry to ENTRY_FINAL.
  for (let i = 0; i < keptReal.length - 1; i++) shrinkEntryToBudget(keptReal[i], ENTRY_MID);
  if (keptReal.length > 0) shrinkEntryToBudget(keptReal[keptReal.length - 1], ENTRY_FINAL);

  details.entries = display;

  // Terminal proof (byte-accurate, bounded). Shrink the largest kept entry
  // toward ENTRY_FLOOR; if all are at the floor and still over, drop a tail
  // entry; if nothing remains to shrink, fall back to the placeholder.
  let guard = 0;
  while (measureBytes(data, ceiling) > ceiling && guard < 200) {
    guard++;
    if (keptReal.length === 0) return truncatedPlaceholder(event, ceiling);
    let largest = keptReal[0];
    let largestBytes = measureBytes(largest, ceiling);
    for (const e of keptReal) {
      const b = measureBytes(e, ceiling);
      if (b > largestBytes) {
        largest = e;
        largestBytes = b;
      }
    }
    if (largestBytes <= ENTRY_FLOOR + 64) {
      // Everything is already at the floor — drop the oldest kept entry.
      const dropped = keptReal.shift();
      const di = display.indexOf(dropped);
      if (di !== -1) display.splice(di, 1);
      if (keptReal.length === 0) return truncatedPlaceholder(event, ceiling);
    } else {
      shrinkEntryToBudget(largest, Math.max(ENTRY_FLOOR, Math.floor(largestBytes / 2)));
    }
  }
  if (measureBytes(data, ceiling) > ceiling) return truncatedPlaceholder(event, ceiling);
  return { ...event, data };
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
    // Detect subagent-timeline events on the ORIGINAL event BEFORE the generic
    // per-field pass, so the generic `obj.length > 20` array clobber can NEVER
    // reach a detected `entries[]` regardless of `maxStringSize`. Over-ceiling
    // → head+tail reduce; under-ceiling → store unchanged (skip generic pass).
    // See change: head-tail-truncate-subagent-event-timeline (D1/D4).
    if (sizePass && locateSubagentTimeline(event)) {
      return exceedsSerializedSize(data, maxEventDataSize)
        ? reduceSubagentEvent(event, maxEventDataSize)
        : event;
    }
    const truncated = stringPass
      ? (truncateStrings(data, maxStringSize) as Record<string, unknown>)
      : (data as Record<string, unknown>);
    if (sizePass && exceedsSerializedSize(truncated, maxEventDataSize)) {
      return truncatedPlaceholder(event, maxEventDataSize);
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
  let collapsedUpdatesTotal = 0;
  // P1 find-cost probe. Reset per insert; distinct from collapsedUpdatesTotal.
  let lastEntriesExamined = 0;
  let maxEntriesExamined = 0;

  function getOrCreate(sessionId: string): SessionBuffer {
    let buf = buffers.get(sessionId);
    if (!buf) {
      buf = { events: [], nextSeq: 1, lastAccess: Date.now(), collapseIndex: new Map() };
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

  /**
   * Locate `seq` in the seq-sorted `buf.events` by scanning BACKWARD from the
   * tail (D6.1). The superseded predecessor sits near the tail, so the scan is
   * bounded by the number of concurrently-streaming tool calls, not by buffer
   * length. A FORWARD scan (the shape `getEvent` uses) would make collapse
   * O(buffer length) per insert — precisely what D6 forbids. Returns -1 on a
   * miss (e.g. trim already dropped the entry); the caller must never let a
   * negative index reach `splice`.
   */
  function findIndexBySeq(buf: SessionBuffer, seq: number): number {
    let examined = 0;
    for (let i = buf.events.length - 1; i >= 0; i--) {
      examined++;
      const s = buf.events[i].seq;
      if (s === seq) {
        lastEntriesExamined = examined;
        if (examined > maxEntriesExamined) maxEntriesExamined = examined;
        return i;
      }
      // Array is seq-ascending: once we are below the target it is absent.
      if (s < seq) break;
    }
    lastEntriesExamined = examined;
    if (examined > maxEntriesExamined) maxEntriesExamined = examined;
    return -1;
  }

  /**
   * D6.2 VERIFIED removal: resolve `prevSeq`, confirm the located entry is
   * still a `tool_execution_update` carrying `toolCallId`, and only then test
   * subsumption and splice. An unresolved lookup (trim already dropped it) is a
   * no-op — a negative index must NEVER reach `splice`, which would delete the
   * buffer's LAST element (the max-seq event).
   */
  function dropIfSuperseded(
    buf: SessionBuffer,
    prevSeq: number,
    toolCallId: string,
    successor: DashboardEvent,
  ): void {
    const i = findIndexBySeq(buf, prevSeq);
    if (i === -1) return;
    const candidate = buf.events[i];
    if (candidate.event.eventType !== "tool_execution_update") return;
    if (readToolCallId(candidate.event) !== toolCallId) return;
    if (!subsumes(candidate.event, successor)) return;
    buf.events.splice(i, 1);
    collapsedUpdatesTotal++;
  }

  /**
   * Drop index entries whose events the trim has already discarded.
   *
   * The buffer's EVENTS are capped, but the index is keyed by `toolCallId`, so
   * without this a long-lived session gains one PERMANENT entry per distinct
   * tool call — an uncapped map inside a change whose purpose is to bound
   * memory. This is the D6.4 leak argument applied WITHIN a session rather than
   * across them: buffer-scoping alone only bounds it at eviction, which a
   * long-lived session never reaches.
   *
   * Called only after a trim actually dropped events, so the O(index) scan is
   * amortized against the trim's own hysteresis, not paid per insert.
   * See change: collapse-superseded-tool-execution-updates.
   */
  function pruneCollapseIndex(buf: SessionBuffer): void {
    const minSeq = buf.events[0]?.seq;
    if (minSeq === undefined) {
      buf.collapseIndex.clear();
      return;
    }
    for (const [toolCallId, entry] of buf.collapseIndex) {
      // `newestSeq` below the surviving floor ⇒ every event for this call is
      // gone ⇒ the entry can never resolve again.
      if (entry.newestSeq === undefined || entry.newestSeq < minSeq) {
        buf.collapseIndex.delete(toolCallId);
        continue;
      }
      // The pinned creating tick was trimmed away: the first-wins fields it
      // carried are already out of the buffer, so the pin protects nothing and
      // would only block a legitimate collapse. Release it.
      if (entry.creatingSeq !== undefined && entry.creatingSeq < minSeq) {
        entry.creatingSeq = undefined;
      }
    }
  }

  /**
   * Drop the previously-retained `tool_execution_update` for this call when the
   * just-inserted `stored` subsumes it (D7), then advance the index. Fail-open
   * on a missing `toolCallId` (D5) and on any unverified lookup (D6.2).
   */
  function collapseSuperseded(buf: SessionBuffer, stored: StoredEvent): void {
    if (stored.event.eventType !== "tool_execution_update") return;
    const toolCallId = readToolCallId(stored.event);
    // D5: an update we cannot key (including a `{__truncated}` placeholder,
    // whose data carries no toolCallId) is retained and collapses nothing.
    if (toolCallId === undefined) return;

    let entry = buf.collapseIndex.get(toolCallId);
    if (!entry) {
      entry = { creatingSeq: undefined, newestSeq: undefined };
      buf.collapseIndex.set(toolCallId, entry);
    }

    const prevSeq = entry.newestSeq;
    // D7: skip removal when the predecessor IS the pinned creating tick.
    if (prevSeq !== undefined && prevSeq !== entry.creatingSeq) {
      dropIfSuperseded(buf, prevSeq, toolCallId, stored.event);
    }

    entry.newestSeq = stored.seq;
    if (entry.creatingSeq === undefined) {
      const details = resolveUpdateDetails(stored.event);
      // Structural pin: the FIRST update carrying `details.agentId` supplies the
      // reducer's first-wins `type`/`description` and is never collapsed away.
      if (details && typeof details.agentId === "string") entry.creatingSeq = stored.seq;
    }
  }

  return {
    insertEvent(sessionId: string, event: DashboardEvent): number {
      const buf = getOrCreate(sessionId);
      const seq = buf.nextSeq++;
      lastEntriesExamined = 0;
      const stored: StoredEvent = { seq, event: truncateEventData(event) };
      buf.events.push(stored);
      // Collapse superseded updates AFTER truncation (so the `{__truncated}`
      // placeholder is already resolved) and BEFORE trim/evict, so the shed
      // policies see the already-collapsed buffer.
      // See change: collapse-superseded-tool-execution-updates (D1, task 2.3).
      collapseSuperseded(buf, stored);
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
          // The trim just raised the buffer's seq floor; release index entries
          // it orphaned so the map tracks RESIDENT calls, not every call ever
          // seen. See change: collapse-superseded-tool-execution-updates.
          pruneCollapseIndex(buf);
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
      // The collapse index rides on `buf`, so dropping the buffer releases it.
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
        collapsedUpdates: collapsedUpdatesTotal,
      };
    },

    getCollapseProbe(): CollapseProbe {
      let indexedToolCalls = 0;
      for (const buf of buffers.values()) indexedToolCalls += buf.collapseIndex.size;
      return { lastEntriesExamined, maxEntriesExamined, indexedToolCalls };
    },
  };
}
