# session-load-worker.ts — index

Pure `loadAndReplay(req): {jobId, success, events, error, entryCount?}` + `parentPort` bootstrap. Runs `loadSessionEntries` (JSONL parse + tree-walk) and `replayEntriesAsEvents(...).map(m => m.event)` projection IN-WORKER; only final `events` array crosses thread boundary. Tests + fallback import function directly. `events` bytes identical to in-process projection; parity test enforces (`__tests__/session-load-worker.test.ts`). See change: offload-session-events-load-to-worker.
