# known-servers-routes.ts — index

Known-servers config + mDNS discovery routes. Exports `registerKnownServersRoutes`. Endpoints: `GET/POST/DELETE /api/known-servers`, `POST /api/discover-servers`. Persists via `writeConfigPartial`, returns peer servers from `getPeerServers`.
