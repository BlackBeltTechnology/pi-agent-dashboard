---
name: build-reload
scope: Detect the three-component rebuild/reload gaps (build / restart / reload).
symptoms:
  - i built it still broken
  - stale client bundle
  - flows dont render
  - old ui after pull
  - bridge not reloaded
  - changes not showing
depends-on:
  - install-topology
derives-from:
  - /api/health mode (server-enriched)
  - dist/client mtime vs client/plugin source mtime (live)
  - packages/extension source mtime vs last reload (live)
---

## SCOPE
Detect the three-component rebuild/reload gaps: stale `dist/client` in
production, and a bridge that changed but was never reloaded into live sessions.

## KNOWLEDGE
Three components, three actions (the rebuild matrix):
- **client → build + restart**: the flows-plugin RENDER code is COMPILED INTO
  the client bundle at build time. Current source with a stale `dist/client` =
  old UI even though the source is fixed.
- **server/shared → restart**: `POST /api/restart` (jiti runs TS directly, no
  build).
- **extension/bridge → reload**: `npm run reload` (or a fresh session).
  Building the web client does NOT reload the bridge.

Trap: "I built it, still broken" = built the client but never reloaded the
bridge, or restarted the server but never rebuilt the client.

## CHECKS
- `/api/health` mode (server-enriched): `production` vs `dev`.
- Production: compare `dist/client` mtime to the newest client/flows-plugin
  source mtime; dist older → stale bundle.
- Compare `packages/extension` source mtime to the last reload; newer source →
  reload gap.

## FIX ROUTING
- stale bundle (production) → `npm run build` + `POST /api/restart`.
- bridge changed, sessions not reloaded → `npm run reload` or a fresh session.
- server/shared changed → `POST /api/restart`.
- **dev mode**: Vite HMR handles the client; only bridge changes need reload.

## DERIVES-FROM
Server-enriched: `/api/health` mode. Live: `dist/client` mtime, source mtimes.
Hash sidecar: `build-reload.knowledge.hash`.
