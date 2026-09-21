/**
 * Session-load worker — parses a session JSONL (`loadSessionEntries`) and
 * materializes the dashboard event array (`replayEntriesAsEvents`) off the
 * main event loop.
 *
 * The main thread keeps ownership of the per-session `loadingSet` dedup, the
 * `eventStore` inserts, and the `event_replay` / `session_updated` broadcasts.
 * This worker performs only the CPU-bound + synchronous-fs parse and replay,
 * then projects to the `events` array IN-WORKER so only the final array
 * crosses the boundary.
 *
 * Output is identical to the prior in-process projection
 * (`loadSessionEntries` + `replayEntriesAsEvents(...).map(m => m.event)`); the
 * parity test in `__tests__/session-load-worker.test.ts` locks the contract.
 *
 * The exported `loadAndReplay(req)` function IS the entire worker body. The
 * `parentPort` bootstrap at the bottom just wires it onto a thread; tests and
 * the in-process fallback import the function directly.
 *
 * See change: offload-session-events-load-to-worker.
 */
import { isMainThread, parentPort } from "node:worker_threads";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { projectDiffEvents } from "./session-diff-source.js";
import { loadSessionEntries, parseSessionEntries, splitTranscriptLines } from "./session-file-reader.js";

export interface SessionLoadRequest {
  jobId: number;
  sessionId: string;
  /**
   * File arm: a path to a local `.jsonl`. EXACTLY ONE of `sessionFile` and
   * `raw` must be set; neither or both is `invalid_request`.
   */
  sessionFile?: string;
  /**
   * Raw-text arm: the transcript's `.jsonl` content, split and parsed IN THE
   * WORKER.
   *
   * Raw text rather than a pre-split `entries` array, because the split is
   * itself main-thread work on up to 256 MB, and one 44 MB string is a
   * memcpy-class clone where 10⁵ separate strings is not. It is also the grain
   * at which parity is free: the raw arm is the file arm's body minus the `fs`
   * read, so identical bytes cannot produce different events.
   * See change: offload-retained-transcript-replay (D1).
   */
  raw?: string;
  /** Persisted `session.contextWindow`; passed through to replay so
   *  `stats_update` events use the real window, not the model heuristic. */
  knownContextWindow?: number;
  /**
   * `"diff-events"` → return ONLY the diff-relevant projection
   * (`projectDiffEvents`) instead of the full replay. Used by
   * `/api/session-diff` to source tool-call events from the durable
   * transcript. See change: fix-session-diff-durable-source.
   */
  mode?: "diff-events";
  /** Per-field string cap for the projection's tool `args` (mirrors the
   *  store's `maxStringFieldSize`; `<= 0` disables truncation). */
  maxStringSize?: number;
}

export interface LoadedEvent {
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface SessionLoadResult {
  jobId: number;
  success: boolean;
  events: LoadedEvent[];
  error?: string;
  /** Parsed entry count — telemetry for the hydration sample. Omitted on the
   *  failure path. Additive; not part of the event-parity contract. */
  entryCount?: number;
  /** Max timestamp over ALL transcript entries. Only set in `"diff-events"`
   *  mode; used to clamp an ended session's open Bash window. */
  lastEntryTs?: number;
}

/**
 * Pure parse + replay + projection. Safe on the main thread (fallback) or
 * inside a `worker_threads` Worker (normal path). Mirrors the prior in-process
 * body in `directory-service.ts::loadSessionEvents()`.
 */
export function loadAndReplay(req: SessionLoadRequest): SessionLoadResult {
  const { jobId, sessionId, sessionFile, raw, knownContextWindow, mode, maxStringSize } = req;
  const hasFile = typeof sessionFile === "string";
  const hasRaw = typeof raw === "string";
  // Two arms, exactly one set. A request naming neither (or both) cannot be
  // resolved to a transcript, and picking one would silently hydrate the wrong
  // one — so it is a refusal, not a guess. See change:
  // offload-retained-transcript-replay (D1).
  if (hasFile === hasRaw) {
    return { jobId, success: false, events: [], error: "invalid_request" };
  }
  try {
    const entries = hasRaw
      ? parseSessionEntries(splitTranscriptLines(raw as string))
      : loadSessionEntries(sessionFile as string);
    if (mode === "diff-events") {
      const { events, lastEntryTs } = projectDiffEvents(sessionId, entries, { maxStringSize });
      return { jobId, success: true, events, entryCount: entries.length, lastEntryTs };
    }
    const events = replayEntriesAsEvents(sessionId, entries, knownContextWindow).map((m) => m.event);
    return { jobId, success: true, events, entryCount: entries.length };
  } catch (err: any) {
    const error = err?.code === "ENOENT" ? "file_not_found" : (err?.message ?? "parse_error");
    return { jobId, success: false, events: [], error };
  }
}

// ── Worker bootstrap ────────────────────────────────────────────────
// Only runs when this module is loaded as the entry of a `worker_threads`
// Worker. Direct imports (tests, in-process fallback) skip this block.
if (!isMainThread && parentPort !== null) {
  parentPort.on("message", (msg: SessionLoadRequest | { type: "shutdown" }) => {
    if ("type" in msg && (msg as { type: string }).type === "shutdown") {
      parentPort!.close();
      return;
    }
    parentPort!.postMessage(loadAndReplay(msg as SessionLoadRequest));
  });
}
