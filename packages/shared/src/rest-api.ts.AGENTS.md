# rest-api.ts — index

REST endpoint request/response types. Sessions, events, spawn, file read/write (`FileWriteRequest` mtime… → see `rest-api.ts.AGENTS.md` `NetworkInterface` gains `label`/`pointToPoint`/`suggestions`; still one entry per address. See change: warn-unreachable-trusted-networks.

Add-ons catalog types: `AddonFeature`, `AddonFeatureKind`, `AddonOrigin`, `AddonFeatureState`, `AddonPackagePart`, `AddonPluginPart`, `AddonCatalogResponse`, `AddonToggleRequest/Response` (+ `AddonKeptOn`, `AddonStillLoadedIn`, `AddonRestoreSkipped`). See change: addons-hub-feature-catalog.

`CatalogueReadyResponse { ready: boolean; fallback?: boolean }` — `GET /api/provider-auth/catalogue-ready`. See change: fix-provider-catalogue-first-run (D4).

- `BrowseResult.confined?` (true for a confined remote listing). See change: harden-server-capability-bounds.

`SessionListItem = DashboardSession & {uiUrl, diffUrl}`; `ListSessionsResponse` retyped (REST-only, never on the WebSocket). See change: add-session-ui-deep-links-for-agents.
