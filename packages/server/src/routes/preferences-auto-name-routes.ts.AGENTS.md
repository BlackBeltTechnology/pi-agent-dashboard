# preferences-auto-name-routes.ts — index

REST routes `GET /api/preferences/auto-name` (returns `{autoNameSessions:boolean}`, default true) + `PATCH /api/preferences/auto-name` (body `{value:boolean}` → `preferences-store.setAutoNameSessions`, then `piGateway.broadcast({type:"preferences_update",autoNameSessions})` to all bridges). Register-time push lives in event-wiring `onSessionRegistered`. See change: add-auto-session-naming.
