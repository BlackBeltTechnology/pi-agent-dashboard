# session-load-worker.ts — index

Pure `loadAndReplay(req): {jobId, success, events, error, entryCount?}` + `parentPort` bootstrap. Runs `loadSessionEntries` (JSONL parse + tree-walk) and `replayEntriesAsEvents(...).map(m => m.event)` projection IN-WORKER; only final `events` array crosses thread boundary. Tests + fallback import function directly. `events` bytes identical to in-process projection; parity test enforces (`__tests__/session-load-worker.test.ts`). See change: offload-session-events-load-to-worker.

See change: fix-session-diff-durable-source — `SessionLoadRequest` gains `mode?: "diff-events"` + `maxStringSize?: number`; in `diff-events` mode `loadAndReplay` returns `projectDiffEvents(sessionId, entries, {maxStringSize})` with `entryCount: entries.length` + `lastEntryTs` (a new optional `SessionLoadResult` field). The pool passes `mode`/`maxStringSize` through and returns `lastEntryTs` (tested in `__tests__/session-load-worker.test.ts`).
