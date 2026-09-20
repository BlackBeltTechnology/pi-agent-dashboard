# session-to-meta.ts — index

Exports `sessionToMeta(session)` — the EXPLICIT `.meta.json` field enumeration extracted from `server.ts` `sessionManager.onChange`. Full-overwrite payload (not a merge): a field omitted here is WIPED on the next save. Includes `tags`. Extracted for unit-testability (wipe-regression guard). See change: add-session-tags. Enumerates `kind` + `automationRun` (the automation spawn seam merges both) so a full overwrite cannot wipe a run's classification/identity and resurface it on the board after a restart. See change: fix-automation-identity-persistence.
