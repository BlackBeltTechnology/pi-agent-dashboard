# preferences-auto-name-routes.ts — index

REST routes `GET /api/preferences/auto-name` (returns `{autoNameSessions:boolean}`, default true) + `PATCH… → see `preferences-auto-name-routes.ts.AGENTS.md` Also serves read-only `GET /api/auto-name-outcomes` → `{outcomes}` from the bounded retention store, the discoverable route to a naming stop latched with no subscribed client. See change: fix-auto-naming-reasoning-model.

PATCH broadcast now sends the full `buildPreferencesUpdate` snapshot (both preferences), not only `autoNameSessions`. See change: retire-anthropic-messages-bridge.
