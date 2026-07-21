# DOX — packages/client/src/lib/replay

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `loading-history.ts` | Exports `clearLoadingHistory(setLoadingHistory, timersRef, id)` + `rearmLoadingHistory(..., ms)` helpers +… → see `loading-history.ts.AGENTS.md` |
| `message-history.ts` | Exports `extractUserPromptHistory(messages)` — collects `role==="user"` prompts for ArrowUp recall; condenses… → see `message-history.ts.AGENTS.md` |
| `rehydrate-session.ts` | rehydrateSession(sessionId,cache). Cache hit → re-reduce raw payload via reduceEvent into provisional… → see `rehydrate-session.ts.AGENTS.md` |
| `replay-cache.ts` | Durable per-session replay cache. IndexedDB.… → see `replay-cache.ts.AGENTS.md` |
| `replay-persist.ts` | Debounced replay-cache writer. createReplayPersister(cache,debounceMs). → see `replay-persist.ts.AGENTS.md` |
