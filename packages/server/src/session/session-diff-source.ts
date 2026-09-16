/**
 * Session-diff event source — where `/api/session-diff` gets its tool-call
 * events from.
 *
 * The in-memory event store is a bounded ring: per-session trim, server
 * restart, LRU eviction and `event_data` size clamping all drop the
 * Write/Edit/Bash `tool_execution_start` events the diff reads, while the
 * session transcript on disk holds them at full fidelity. This module:
 *
 *   - `projectDiffEvents` — a diff-only projection of the on-disk transcript
 *     (assistant `message_end` + `tool_execution_start`/`_end`, live order,
 *     args capped with the store's own truncation helper so payloads are
 *     byte-identical to the store path).
 *   - `resolveDiffSource` — picks transcript-vs-store, computes the cache
 *     source signature, and returns a lazy `load()`.
 *
 * The projection is consumed by the session-load worker (`mode:
 * "diff-events"`); `resolveDiffSource` dispatches to it (worker) or runs it
 * in-process when the pool is absent/disposed.
 *
 * See change: fix-session-diff-durable-source.
 */
import { stat } from "node:fs/promises";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import { truncateStrings } from "../persistence/memory-event-store.js";
import { loadSessionEntries, type SessionEntry } from "./session-file-reader.js";
import type { SessionLoadWorkerPool } from "./session-load-worker-pool.js";
import { mayReadLocalSessionFile, originOf } from "./session-origin.js";

/** The two events the diff reads back from any source. */
export interface DiffEventSource {
  events: DashboardEvent[];
  /** Max timestamp over ALL transcript entries (not just projected ones). */
  lastEntryTs?: number;
}

/** Minimal session shape `resolveDiffSource` reads. */
export interface DiffSourceSession {
  id: string;
  sessionFile?: string;
  originDeviceId?: string;
}

function makeEvent(
  eventType: string,
  timestamp: number,
  data: Record<string, unknown>,
): DashboardEvent {
  return { eventType, timestamp, data: { type: eventType, ...data } };
}

function tryParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Project `SessionEntry[]` to ONLY the events `buildSessionDiff` reads:
 * assistant `message_end` (text parts only, BEFORE its tool starts — live
 * order), every `tool_execution_start`, and `tool_execution_end`. Open tool
 * calls are left open (NO synthetic end) because a live running Bash window
 * must stay `[start, now]`, exactly as on the store path.
 *
 * Tool `args` run through the store's `truncateStrings` with the same cap the
 * store used on ingest, so a transcript-sourced diff has identical payload
 * sizes and `truncated` flags (`maxStringSize <= 0` — the shipped default —
 * disables truncation, mirroring `createTruncator`).
 */
export function projectDiffEvents(
  sessionId: string,
  entries: SessionEntry[],
  opts: { maxStringSize?: number } = {},
): DiffEventSource {
  const maxStringSize = opts.maxStringSize ?? 0;
  const cap: (v: unknown) => unknown =
    maxStringSize > 0 ? (v) => truncateStrings(v, maxStringSize) : (v) => v;

  const events: DashboardEvent[] = [];
  let lastEntryTs: number | undefined;

  for (const entry of entries) {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
    if (Number.isFinite(ts) && (lastEntryTs === undefined || ts > lastEntryTs)) lastEntryTs = ts;
    if (entry.type !== "message" || !entry.message) continue;
    projectMessageEntry(entry, ts, cap, events);
  }

  return { events, lastEntryTs };
}

interface ProjectablePart {
  type?: string;
  text?: unknown;
  id?: string;
  name?: string;
  arguments?: unknown;
}

/** Append the projected events for one `message` entry (see `projectDiffEvents`). */
function projectMessageEntry(
  entry: SessionEntry,
  ts: number,
  cap: (v: unknown) => unknown,
  out: DashboardEvent[],
): void {
  const msg = entry.message as {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };

  if (msg.role === "assistant") {
    projectAssistantEntry(entry, msg, ts, cap, out);
    return;
  }

  if (msg.role === "toolResult" && msg.toolCallId) {
    out.push(makeEvent("tool_execution_end", ts, {
      toolCallId: msg.toolCallId,
      toolName: msg.toolName ?? "unknown",
      isError: msg.isError ?? false,
    }));
  }
}

/** Project one assistant entry: its `message_end` then each tool call's start. */
function projectAssistantEntry(
  entry: SessionEntry,
  msg: { content?: unknown },
  ts: number,
  cap: (v: unknown) => unknown,
  out: DashboardEvent[],
): void {
  const content = Array.isArray(msg.content) ? (msg.content as ProjectablePart[]) : [];
  // message_end BEFORE the tool starts its assistant message carries.
  const textParts = content
    .filter((c) => c?.type === "text")
    .map((c) => ({ type: "text", text: cap(c.text) }));
  out.push(makeEvent("message_end", ts, {
    message: { role: "assistant", content: textParts },
    ...(entry.id ? { entryId: entry.id } : {}),
  }));
  for (const part of content) {
    if (part?.type !== "toolCall") continue;
    const args = typeof part.arguments === "string"
      ? tryParseJson(part.arguments)
      : part.arguments;
    out.push(makeEvent("tool_execution_start", ts, {
      toolCallId: part.id,
      toolName: part.name,
      args: cap(args),
    }));
  }
}

/** Count the store events whose arrival can change a diff. */
function countDiffToolStarts(events: DashboardEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.eventType !== "tool_execution_start") continue;
    const tool = ((e.data.toolName as string) || "").toLowerCase();
    if (tool === "write" || tool === "edit" || tool === "bash") n++;
  }
  return n;
}

/** Store-sourced events + the last stored event's timestamp. */
function storeDiffSource(eventStore: EventStore, sessionId: string): DiffEventSource {
  const events = eventStore.getEvents(sessionId, 0).map((e) => e.event);
  const lastEntryTs = events.length > 0 ? events[events.length - 1].timestamp : undefined;
  return { events, lastEntryTs };
}

/**
 * `t:<mtime>:<size>` for a transcript-eligible session; ANY stat error
 * (ENOENT, EACCES, …) collapses to `t:0:0` ("no transcript") — never a throw.
 */
async function transcriptSourceKey(sessionFile: string): Promise<string> {
  try {
    const s = await stat(sessionFile);
    return `t:${s.mtimeMs}:${s.size}`;
  } catch {
    return "t:0:0";
  }
}

/**
 * Load the transcript's projected events; fall back to the store when the
 * transcript yields ZERO entries (missing / header-only / corrupt) or the
 * load fails. Mirrors D1: the store can never be worse than an empty
 * transcript.
 */
async function loadTranscriptOrStore(
  session: DiffSourceSession,
  sessionFile: string,
  eventStore: EventStore,
  opts: { pool?: SessionLoadWorkerPool | null; maxStringSize?: number },
): Promise<DiffEventSource> {
  let entryCount: number | undefined;
  let projected: DiffEventSource | undefined;

  const pool = opts.pool;
  if (pool) {
    try {
      const { result } = pool.load({
        sessionId: session.id,
        sessionFile,
        mode: "diff-events",
        maxStringSize: opts.maxStringSize,
      });
      const out = await result;
      if (out.success) {
        entryCount = out.entryCount;
        projected = { events: out.events as DashboardEvent[], lastEntryTs: out.lastEntryTs };
      }
    } catch {
      projected = undefined;
    }
  } else {
    try {
      const entries = loadSessionEntries(sessionFile);
      entryCount = entries.length;
      projected = projectDiffEvents(session.id, entries, { maxStringSize: opts.maxStringSize });
    } catch {
      projected = undefined;
    }
  }

  if (projected && (entryCount ?? projected.events.length) > 0) return projected;
  return storeDiffSource(eventStore, session.id);
}

/** The cache signature + lazy loader for one session's diff. */
export interface DiffSource {
  sourceKey: string;
  load: () => Promise<DiffEventSource>;
}

/**
 * Resolve how `/api/session-diff` gets `session`'s tool-call events.
 *
 * Gate (`mayReadLocalSessionFile`): pass → transcript source with key
 * `t:<mtime>:<size>` and a loader that dispatches to the worker pool (or runs
 * the projection in-process when the pool is absent/disposed); fail (remote
 * origin, no `sessionFile`) → store source with key `s:<diff-tool-start
 * count>` and the store's events. Remote sessions NEVER stat/read their
 * `sessionFile` here. The fallback from an empty transcript to the store is
 * decided INSIDE `load()` (after the parse), so the key does not depend on it.
 */
export async function resolveDiffSource(
  session: DiffSourceSession,
  eventStore: EventStore,
  opts: { pool?: SessionLoadWorkerPool | null; maxStringSize?: number } = {},
): Promise<DiffSource> {
  const verdict = mayReadLocalSessionFile({
    origin: originOf(session),
    sessionFile: session.sessionFile,
  });

  if (verdict.allow) {
    const sessionFile = verdict.sessionFile;
    const sourceKey = await transcriptSourceKey(sessionFile);
    return {
      sourceKey,
      load: () => loadTranscriptOrStore(session, sessionFile, eventStore, opts),
    };
  }

  // Remote origin or no sessionFile: store source, key on the only events
  // whose arrival can change the diff (not raw count / maxSeq — streaming
  // deltas would churn those). Never touches the transcript path.
  const storeKey = `s:${countDiffToolStarts(eventStore.getEvents(session.id, 0).map((e) => e.event))}`;
  return {
    sourceKey: storeKey,
    load: async () => storeDiffSource(eventStore, session.id),
  };
}
