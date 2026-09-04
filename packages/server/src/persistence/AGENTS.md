# DOX — packages/server/src/persistence

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `boot-state.ts` | Durable HOME-scoped boot record `~/.pi/dashboard/boot-state.json` (atomic tmp+rename, O(1) per exit — not per session). Exports `stampBootStart(bootId=liveEpoch)`, `recordExitIntent(intent)` (write-once per boot, first writer wins), `resolveExitIntent(liveEpoch)` (current record then 8-entry ring; unresolvable ⇒ `null` ⇒ recovery allowed), `readBootState`, `_resetBootStateForTests`. Write failures logged, never thrown. See change: fix-recovery-exit-intent. |
| `json-store.ts` | Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on… → see `json-store.ts.AGENTS.md` |
| `memory-event-store.ts` | In-memory event store with LRU eviction; replaces SQLite-backed event-store. → see `memory-event-store.ts.AGENTS.md` |
| `meta-persistence.ts` | Per-session debounced `.meta.json` writer. Exports `MetaPersistence`, `createMetaPersistence`. → see `meta-persistence.ts.AGENTS.md` |
| `migrate-persistence.ts` | Migration utility: converts `sessions.json` + `state.json` → per-session `.meta.json` + `preferences.json`. → see `migrate-persistence.ts.AGENTS.md` |
| `migrate-custom-entry-fallback.ts` | `migrateCustomEntryFallbackOverrides(sessionsDir?)` — boot-time sweep: legacy `customEntryFallback` in every `.meta.json#displayPrefsOverride` migrates (legacy `false` seeds every shipped group hidden + `other`), field dropped, atomic write, idempotent. See change: add-custom-event-group-filters. |
| `preferences-store.ts` | Global UI preferences store — JSON-backed with debounced writes. → see `preferences-store.ts.AGENTS.md` `backfillDisplayPrefs` seeds `customEventGroups` from the configured groups (`deps.customEventGroupDefaults`) and runs the one-shot legacy migration at load; load-time prefs content change sets the dirty flag (migration is durable). `setDisplayPrefs` deep-merges `customEventGroups` field-by-field via `mergeCustomEventGroupPrefs`. See changes: render-inline-reasoning-and-custom-entries, add-custom-event-group-filters. |
