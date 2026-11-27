# runtime-client-listing.ts — index

`buildRuntimeClientListing(admitted)` / `toListingEntry` / `assetUrl(id,sha,rel)`: payload of `GET /api/plugins/runtime-clients`; claims keep every field, `module` → asset URL; `routes` = serializable `shell-overlay-route` descriptors. See change: decouple-plugins-from-core (6.11).
