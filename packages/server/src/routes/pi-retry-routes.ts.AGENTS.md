# pi-retry-routes.ts — index

pi retry-policy editor. Exports `registerPiRetryRoutes(fastify,{networkGuard,reloadConnectedSessions})`. `GET /api/pi-retry` → effective policy from `~/.pi/agent/settings.json`. `PUT /api/pi-retry` → validate + merge-preserving write via `pi-agent-settings.ts`, THEN `reloadConnectedSessions()` (pi reads settings only at session construction, so a write alone is inert for running sessions); returns `{policy,reloadedSessions}`. Failed write reloads NOTHING. Auth-gated by the same networkGuard as `/api/config`. `retry.provider.*` deliberately not exposed. See change: retry-forever-with-stop-control.

`PUT /api/pi-retry` is async over the shared pi settings lock: held lock → `503`, unparseable file → `400` (never overwritten from `{}`); neither reloads. See change: edit-pi-agent-settings.
