# DOX — packages/server/src/persistence

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `boot-state.ts` | Durable HOME-scoped boot record `~/.pi/dashboard/boot-state.json` (atomic tmp+rename, O(1) per exit — not per session). Exports `stampBootStart(bootId=liveEpoch)`, `recordExitIntent(intent)` (write-once per boot, first writer wins), `resolveExitIntent(liveEpoch)` (current record then 8-entry ring; unresolvable ⇒ `null` ⇒ recovery allowed), `readBootState`, `_resetBootStateForTests`. Write failures logged, never thrown. See change: fix-recovery-exit-intent. |
| `json-store.ts` | Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on… → see `json-store.ts.AGENTS.md` |
| `memory-event-store.ts` | In-memory event store with LRU eviction; replaces SQLite-backed event-store. → see `memory-event-store.ts.AGENTS.md` |
| `meta-persistence.ts` | Per-session debounced `.meta.json` writer. Exports `MetaPersistence`, `createMetaPersistence`. → see `meta-persistence.ts.AGENTS.md` |
| `migrate-persistence.ts` | Migration utility: converts `sessions.json` + `state.json` → per-session `.meta.json` + `preferences.json`. → see `migrate-persistence.ts.AGENTS.md` |
| `preferences-store.ts` | Global UI preferences store — JSON-backed with debounced writes. → see `preferences-store.ts.AGENTS.md` backfillDisplayPrefs + setDisplayPrefs literals gain `reasoningInlineFlow:false` / `customEntryFallback:true` — the backfill is what resolves legacy files. See change: render-inline-reasoning-and-custom-entries. |
