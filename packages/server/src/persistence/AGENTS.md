# DOX — packages/server/src/persistence

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `json-store.ts` | Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on… → see `json-store.ts.AGENTS.md` |
| `memory-event-store.ts` | In-memory event store with LRU eviction; replaces SQLite-backed event-store. → see `memory-event-store.ts.AGENTS.md` |
| `meta-persistence.ts` | Per-session debounced `.meta.json` writer. Exports `MetaPersistence`, `createMetaPersistence`. → see `meta-persistence.ts.AGENTS.md` |
| `migrate-persistence.ts` | Migration utility: converts `sessions.json` + `state.json` → per-session `.meta.json` + `preferences.json`. → see `migrate-persistence.ts.AGENTS.md` |
| `preferences-store.ts` | Global UI preferences store — JSON-backed with debounced writes. → see `preferences-store.ts.AGENTS.md` |
