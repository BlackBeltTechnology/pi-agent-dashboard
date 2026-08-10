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
import { loadSessionEntries } from "./session-file-reader.js";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";

export interface SessionLoadRequest {
  jobId: number;
  sessionId: string;
  sessionFile: string;
  /** Persisted `session.contextWindow`; passed through to replay so
   *  `stats_update` events use the real window, not the model heuristic. */
  knownContextWindow?: number;
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
}

/**
 * Pure parse + replay + projection. Safe on the main thread (fallback) or
 * inside a `worker_threads` Worker (normal path). Mirrors the prior in-process
 * body in `directory-service.ts::loadSessionEvents()`.
 */
export function loadAndReplay(req: SessionLoadRequest): SessionLoadResult {
  const { jobId, sessionId, sessionFile, knownContextWindow } = req;
  try {
    const entries = loadSessionEntries(sessionFile);
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
