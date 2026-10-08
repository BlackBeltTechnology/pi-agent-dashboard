# custom-entry-forward.ts — index

Pure mappers for the bridge's custom-content forwarding: `toCustomEntryForward(entry)` (null for non-custom/empty/`flow-event` customType) and `toCustomMessageForward({customType,content,display,details,entryId})` (null for `display === false` exact, or flow-event). Driven by `wrapCustomPersistenceForCtx` in bridge.ts. Payload types carry optional `groupId` — server-stamped, never set extension-side. See changes: render-inline-reasoning-and-custom-entries, add-custom-event-group-filters.
