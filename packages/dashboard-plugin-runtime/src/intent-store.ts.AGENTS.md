# intent-store.ts — index

Client store for `plugin_intents` broadcasts. Exports `IntentKey`, `keyToString`, `IntentStoreEntry`, `IntentStore` class (Map keyed `pluginId|sessionId|slot`, memoized per-slot snapshots, `clearForSession`), module singleton `intentStore`, `useSlotIntents(slot,sessionId)` hook built on `useSyncExternalStore`. Stable `EMPTY_SLOT` fallback.
