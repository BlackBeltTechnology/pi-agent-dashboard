## Why

After `addons-hub-declutter`, the Add-ons page still lists `packages[]` entries, not features. One feature is often split: Goal = a dashboard plugin (Plugins page) + a managed bridge + `@ricoyudog/pi-goal-hermes` (Add-ons page), and nothing links them. Disabling the Goal plugin leaves its pi extension loading in every session. Users also cannot tell what pi-dashboard ships versus what a third party ships. This is phase 2 of 3 of the Add-ons hub.

## What Changes

- **NEW** server endpoint `GET /api/addons/catalog` that joins installed packages, discovered dashboard plugins, managed bridges and the recommended manifest into **features**: one entry per feature with its parts (dashboard plugin, bridge, pi packages and their contents), kind, origin and enabled state.
- **NEW** endpoint `POST /api/addons/:featureId/toggle` — one switch per feature: turning a feature off disables its dashboard plugin **and** turns off loading of its pi package(s) at global scope (pi's object-form filter with every resource type set to `[]`); turning it on restores the exact previous entry. Plugin dependency cascade works at feature level: features whose plugins depend on the one being turned off also go fully off (and enabling cascades to the features of required plugins); the confirmation lists them. A pi package another enabled plugin still requires stays on, the response says so, and the feature shows as partly on. A `dryRun` flag returns the same report without writing; the confirmation dialog uses it. Folders whose own `.pi/settings.json` lists the same package keep loading it there; the response reports them as `stillLoadedIn` (scanned over the dashboard's known directories).
- **CHANGED** Add-ons page Installed list: one row per feature, part chips (dashboard UI / extension / bridge / skills / prompts / themes), an origin badge (`pi-dashboard`, `dashboard UI · ext by <author>`, `community`, `pi core`), a "Delivered by" count strip, grouping (by kind / who delivers it / install source / A–Z). Expanding a row shows "For the AI agent (pi)" and "For this dashboard" panels.
- **CHANGED** installed-list filters: keep the text filter and `Local source`; drop the `Update available` chip (the Updates tab replaces it); add `From pi-dashboard`, `Community`, `Has dashboard UI`, `Agent only`, `Disabled`. All chips combine with AND.
- **NEW** Add-ons tabs: **Installed**, **Updates** (every feature with an update + pi core, one "Update all"), **Discover** (recommended-not-installed + npm search + install-from-source). The recommended panel moves into Discover.
- **CHANGED** concept explainer: the worked example becomes data-driven (first installed feature that has both parts); the part legend lists the part chips above (no `tools` — tools are registered at runtime).

Mockup: `mockups/extensions-hub/index.html` — in scope: Installed / Updates / Discover tabs only. Its Issues tab and `folder.html` belong to `addons-hub-folder-view`. The mixed (partial) switch state is not drawn in the mockup; design D6 defines it.

Depends on: `addons-hub-declutter` (archived 2026-10-12; this change's deltas are written against its result in `openspec/specs/`).

## Non-goals

- Removing the `/settings/plugins` activation index or plugin settings pages — they stay, with today's plugin-only toggle semantics.
- Folder-scope toggling, the folder Add-ons page, and the Issues tab — `addons-hub-folder-view`. This change only *reports* folders that keep loading a package; the folder page keeps today's row list.
- A server-side update cache — update badges keep coming from the client's existing check-updates results.
- Runtime tool counts (tools are registered by extensions at runtime; the catalog reports static contents only).
- Uninstalling a plugin that ships with the dashboard.

## Capabilities

### New Capabilities
- `addons-feature-catalog`: feature joining rules, origin classification, catalog endpoint, combined feature toggle (incl. cascade, restore records, folder report), feature-row UI, tabs, Delivered-by strip and grouping.

### Modified Capabilities
- `pi-core-version-ui`: the unified section renders feature groups (Core / Agent + dashboard / Dashboard-only / Agent-only) instead of Core / Recommended / Other; local-badge + reset move to each package part of a feature.
- `addons-hub`: explainer example + part legend, part-label tooltip set, recommended-once rule (panel moves to Discover tab), installed-list filter chips, local-source banner counts features.

## Impact

- Server: new `packages/server/src/routes/addons-routes.ts` + pure `packages/server/src/addons/addons-catalog.ts` joiner + `addon-toggle-restore.ts` store; reuses `listConfiguredPackages`/enricher, `discoverPlugins` data (`packageName`, `bridgeEntryPath`, `firstParty`, `requires.piExtensions`, `dependsOn`), `listManagedBridges`, `RECOMMENDED_EXTENSIONS`, `packageIdentity`, `directoryService.knownDirectories()`. Refactors (behaviour-preserving): the per-settings-file write lock in `resource-activation-routes.ts` becomes a shared export; the plugin toggle's cascade+write in `plugin-activation-routes.ts` becomes `setPluginsEnabled` used by both routes, and the Plugins-index toggle gains a write lock (today it has none).
- Shared: `AddonFeature`, `AddonCatalogResponse`, `AddonToggleRequest/Response` in `rest-api.ts`. No new browser-protocol message.
- Client: Add-ons page rows/tabs — `UnifiedPackagesSection` keeps its name and lifecycle (health fetch, update auto-check) and renders the feature list; `PackageHealthPanel` stays above it; `usePackageOperations` + package queue reused for update/uninstall/core update.
- Behaviour change: disabling a feature from the hub also stops its pi package(s) in new sessions (sessions need reload; existing reload prompt reused). Disabling from the Plugins index keeps today's plugin-only behaviour.
- Rollback: revert. Restore records in `~/.pi/dashboard/addon-toggle-restore.json` are machine-local. A feature turned off before rollback stays off — the user re-enables the pi package by editing its filter entry or from Resources.

## Discipline Skills

- `doubt-driven-review`: the combined toggle rewrites `~/.pi/agent/settings.json` package entries (filter form) and plugin config under one lock — review the write/restore/rollback path before it stands.
- `observability-instrumentation`: new endpoints; log each toggle's writes (feature, plugins flipped, sources filtered/restored/kept on, stillLoadedIn).
- `review-code`: before commit.
