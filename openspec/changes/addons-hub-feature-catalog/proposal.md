## Why

After `addons-hub-declutter`, the Add-ons page still lists `packages[]` entries, not features. One feature is often split: Goal = a dashboard plugin (Plugins page) + a managed bridge + `@ricoyudog/pi-goal-hermes` (Add-ons page), and nothing links them. Disabling the Goal plugin leaves its pi extension loading in every session. Users also cannot tell what pi-dashboard ships versus what a third party ships. This is phase 2 of 3 of the Add-ons hub.

## What Changes

- **NEW** server endpoint `GET /api/addons/catalog` that joins installed packages, discovered dashboard plugins, managed bridges and the recommended manifest into **features**: one entry per feature with its parts (dashboard plugin, bridge, pi packages and their contents), kind, origin and enabled state.
- **NEW** endpoint `POST /api/addons/:featureId/toggle` — one switch per feature: turning a feature off disables its dashboard plugin **and** turns off loading of its required pi package(s) at global scope (pi's object-form filter with every resource type set to `[]`); turning it on restores the exact previous entry. A pi package still required by another enabled feature stays on and the response says so.
- **CHANGED** Add-ons page Installed list: one row per feature, part chips (dashboard UI / extension / bridge / skills / prompts / themes), an origin badge (`pi-dashboard`, `dashboard UI · ext by <author>`, `community`, `pi core`), a "Delivered by" count strip, filters (`From pi-dashboard`, `Community`, `Has dashboard UI`, `Agent only`, `Local source`, `Disabled`) and grouping (by kind / who delivers it / install source / A–Z). Expanding a row shows "For the AI agent (pi)" and "For this dashboard" panels.
- **NEW** Add-ons tabs: **Installed**, **Updates** (every feature with an update + pi core, one "Update all"), **Discover** (recommended-not-installed + npm search + install-from-source).
- Explainer example becomes data-driven (first installed feature that has both parts).

Mockup: `mockups/extensions-hub/index.html`.

Depends on: `addons-hub-declutter` (archive it first; this change's `pi-core-version-ui` delta is written against its result).

## Non-goals

- Removing the `/settings/plugins` activation index or plugin settings pages — they stay; the hub uses the same toggle path.
- Folder scope and the Issues tab — `addons-hub-folder-view`.
- Runtime tool counts (tools are registered by extensions at runtime; the catalog reports static contents only).
- Uninstalling a plugin that ships with the dashboard.

## Capabilities

### New Capabilities
- `addons-feature-catalog`: feature joining rules, origin classification, catalog endpoint, combined feature toggle, feature-row UI, tabs, filters and grouping.

### Modified Capabilities
- `pi-core-version-ui`: the unified section renders feature groups (Core / Agent + dashboard / Dashboard-only / Agent-only) instead of Core / Recommended / Other.

## Impact

- Server: new `packages/server/src/routes/addons-routes.ts` + pure `addons-catalog.ts` joiner; reuses `listConfiguredPackages`/enricher, plugin discovery (`/api/plugins` data incl. `firstParty`, `requires.piExtensions`, `packageDir`), `listManagedBridges`, `RECOMMENDED_EXTENSIONS`, the plugin toggle path, and the settings writer + `resource-entry-ownership.ts` for restore records.
- Shared: `AddonFeature`, `AddonCatalogResponse`, `AddonToggleRequest/Response` in `rest-api.ts`.
- Client: Add-ons page rows/tabs (`UnifiedPackagesSection` replaced by a feature list), `usePackageOperations` reused for update/uninstall.
- Behaviour change: disabling a plugin from the hub also stops its pi extension in new sessions (sessions need reload; existing reload prompt reused). Disabling from the Plugins index keeps today's plugin-only behaviour.
- Rollback: revert; restore records in `~/.pi/dashboard/` are machine-local. A feature turned off before rollback stays off — the user can re-enable the pi package filter by hand or from Resources.

## Discipline Skills

- `doubt-driven-review`: the combined toggle rewrites `~/.pi/agent/settings.json` package entries (filter form) — review the write/restore path before it stands.
- `observability-instrumentation`: new endpoints; log each toggle's writes (plugin id, sources touched, kept-on sources).
- `review-code`: before commit.
