# session-to-meta.ts — index

Exports `sessionToMeta(session)` — the EXPLICIT `.meta.json` field enumeration extracted from `server.ts` `sessionManager.onChange`. Full-overwrite payload (not a merge): a field omitted here is WIPED on the next save. Includes `tags`. Extracted for unit-testability (wipe-regression guard). See change: add-session-tags.
