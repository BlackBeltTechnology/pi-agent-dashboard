# meta-persistence.ts — index

Per-session debounced `.meta.json` writer. Exports `MetaPersistence`, `createMetaPersistence`. Each session gets own 1s debounce timer; `save`, `flushAll`, `dispose`. Synchronous bypass methods `setDisplayPrefsOverride` (set/delete via read-modify-write) and `setProcessDrawerCollapsed` write immediately. `setLiveness` eagerly (atomic, non-debounced) stamps `{live,liveEpoch,closedReason}`; debounced `save()` carries forward on-disk liveness fields so a routine stats write never clobbers them. See change: reopen-sessions-after-shutdown.
