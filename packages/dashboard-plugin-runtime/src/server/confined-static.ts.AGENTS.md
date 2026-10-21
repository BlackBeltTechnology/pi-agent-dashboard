# confined-static.ts — index

Realpath-confined static helpers extracted from `app-mount.ts` (no behaviour change): `STATIC_MIME` (app allowlist), `PLUGIN_ASSET_MIME` (js/mjs/css/fonts/images; no html/wasm/map/json), `isWithin`, `canonicalize`, `acceptsGzip`, `realFileWithin`, `parseSegments(rawPath, prefix, allow?)`, `pickVariant` (`.gz` sibling for gzip client). Reused by content hash + `/plugin-assets`. See change: decouple-plugins-from-core (task 6.8, D13).
