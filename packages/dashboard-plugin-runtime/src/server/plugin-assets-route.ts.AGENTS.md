# plugin-assets-route.ts — index

`registerPluginAssetsRoute(fastify,{getRegistry})`: `GET /plugin-assets/:id/:sha/*` — 404 unless `(id,sha)` admitted AND sha is the current content hash; `PLUGIN_ASSET_MIME` allowlist, confined, `.gz` negotiation, `Cache-Control: public, max-age=31536000, immutable`, no per-app CSP, no auth skip. See change: decouple-plugins-from-core (6.10).
