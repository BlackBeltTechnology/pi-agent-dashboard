# pi-core-routes.ts — index

Pi CLI core package version check + update. Exports `registerPiCoreRoutes`, `PiCoreRouteDeps`. Endpoints: `GET /api/pi-core/versions` (refresh query), `POST /api/pi-core/update`. Broadcasts `pi_core_update_complete` via `onUpdateComplete` so other tabs refetch.
