## Why

Dashboard plugins ship today only as workspace packages under `<dashboard-cwd>/packages/*`. Third-party plugins (e.g. a settings screen for the companion extension `@blackbelt-technology/pi-dashboard-subagents`) cannot reach the dashboard because `discoverPlugins()` does not scan pi-installed packages. Closing that gap lets `pi install npm:<plugin>` deliver both the pi extension and its dashboard plugin in a single step, using pi's existing installer — no parallel install system.

Two concrete use-cases driving this:
1. `@blackbelt-technology/pi-dashboard-subagents` wants a Settings → General section to edit the plugin's own config instead of a 7-step `ctx.ui.input` wizard.
2. The dashboard's Plugin status (`/api/health.plugins[]`) is server-side complete but invisible in the UI; failing plugins disappear silently.

## What Changes

- **Discovery (shipped — diverged from original spec)**: `discoverPlugins()` scans three directories in priority order: `<monorepo>/packages/*/` (workspace), `~/.pi/dashboard/plugins/` (user-installed, per `add-plugin-activation-ui`), and `resources/plugins/` (bundled). Deduplication prefers workspace over installed over bundled. **Not implemented**: scanning `~/.pi/agent/settings.json#packages[]` via `pi-resource-scanner.resolvePackagePath()` — that remains the single remaining gap.
- **Scope (not implemented)**: Phase 1 global-scope-only plus local-detection warning. No scanning of `~/.pi/agent/settings.json#packages[]` implemented; no `source: "global" | "local-detected"` field; no local-detection helper exists.
- **Cache invalidation (not implemented)**: No post-install/remove/update hooks in `package-routes.ts`. `clearDiscoveryCache()` exists but no caller triggers it after package mutation. No `plugins_changed` broadcast.
- **UI surface (COMPLETE)**: A `<PluginsSection>` component renders in Settings → General, fetching `/api/health.plugins[]` and listing each plugin with status, claim count, error text, dependency graph, and enable/disable toggle. Shipped via `add-plugin-activation-ui`.
- **Discoverability (not implemented)**: `npm-search-proxy` keyword filter still searches only `keywords:pi-package`; `pi-dashboard-plugin` not accepted.
- **Trust model**: Plugins execute arbitrary React + Node code with the same trust as any pi extension. README SHALL document this explicitly. No allowlist gating in this change.

## Capabilities

### New Capabilities

(none — this change extends existing capabilities only)

### Modified Capabilities

- `dashboard-plugin-loader` (partially shipped, diverged): discovery contract extended to scan 3 locations (workspace, `~/.pi/dashboard/plugins/`, `resources/plugins/`); cache invalidation (`clearDiscoveryCache()`) exists but has no caller. NOT implemented: reading `~/.pi/agent/settings.json#packages[]`, local-scope detection.
- `package-install` (not implemented): post-mutation hook for cache invalidation + status re-broadcast does not exist.

## Impact

**Code**:
- `packages/dashboard-plugin-runtime/src/server/loader.ts` — shipped: `discoverPlugins()` scans workspace + `~/.pi/dashboard/plugins/` + `resources/plugins/`. NOT implemented: `~/.pi/agent/settings.json#packages[]` scanning. See drift reconciliation.
- `packages/server/src/routes/package-routes.ts` — NOT implemented: no cache-invalidation or broadcast hooks.
- `packages/server/src/npm-search-proxy.ts` — NOT implemented: still accepts only `keywords:pi-package`.
- `packages/client/src/components/SettingsPanel.tsx` + `PluginsSection.tsx` — COMPLETE. Shipped via `add-plugin-activation-ui`.
- `packages/dashboard-plugin-runtime/src/server/plugin-status-store.ts` — NOT implemented: no `source` field, no `plugins_changed` broadcast.

**APIs**:
- `/api/health.plugins[]` entries — NOT implemented: no `source` field added. The current `PluginStatus` (`n` in `plugin-status.ts`) lacks `source` entirely.
- WS broadcast: NOT implemented: no `plugins_changed` event in `browser-protocol.ts`. Only per-plugin `plugin_config_update` exists.

**Dependencies**: none new. `pi-resource-scanner.resolvePackagePath()` was never wired in; the shipped `discoverPlugins()` uses `findInstalledPluginsDir()` + `findBundledPluginsDir()` instead.

**Operational**: cache invalidation timing is the only subtle concern — a plugin can ship a `bridge` entry that the dashboard auto-writes into pi's `settings.json#dashboardPluginBridges`; the user's running pi sessions need a reload to pick it up. This is the same constraint that already governs pi extension installs — no new behaviour to design here.

## Drift reconciliation — 2026-07-13

### Client UI → COMPLETE

Tasks 7.x (PluginsSection client component) shipped in full via `add-plugin-activation-ui` (2026-05-16).
`packages/client/src/components/PluginsSection.tsx` renders in Settings → General with:
- Status pills (enabled/error/disabled/not loaded)
- Enable/disable toggle with dependency-graph cascade dialog
- Error display with copy-to-clipboard
- Missing-requirements inline install buttons
- Restart-required banner
- Per-plugin settings-section expand

### Server-side discovery → PARTIALLY SHIPPED (diverged architecture)

The current `discoverPlugins()` in `packages/dashboard-plugin-runtime/src/server/loader.ts` scans three locations: workspace `packages/*/`, `~/.pi/dashboard/plugins/`, and `resources/plugins/` — in priority order (workspace > user-installed > bundled), dedup by plugin id. This was shipped under `add-plugin-activation-ui` rather than the `external-dashboard-plugins` proposal. `clearDiscoveryCache()`, dependency graph, and requirement probes exist.

### Core gap → NOT IMPLEMENTED

The proposal's primary ask — scanning `~/.pi/agent/settings.json#packages[]` entries resolved via `pi-resource-scanner.resolvePackagePath()` — was never built. The shipped `discoverPlugins()` uses `findInstalledPluginsDir()` (`~/.pi/dashboard/plugins/`, a separate older mechanism) rather than the pi-package-resolver seam.

### Other unimplemented items

| Area | Status |
|---|---|
| `loadGlobalPiPackages()` wrapper in `packages/server/src/` | NOT IMPLEMENTED |
| `source: "global" | "workspace"` field on `PluginStatus`/`DiscoveredPlugin` | NOT IMPLEMENTED — `plugin-status-store.ts` has no `source` |
| Local-scope detection (`discoverLocalDetectedPlugins`) | NOT IMPLEMENTED |
| `plugins_changed` WS broadcast | NOT IMPLEMENTED — only `plugin_config_update` exists |
| Package-routes cache-invalidation hook (`recomputeAndBroadcastPlugins`) | NOT IMPLEMENTED |
| Local-detection lifecycle hooks (session create/destroy) | NOT IMPLEMENTED |
| `npm-search-proxy` keyword `pi-dashboard-plugin` | NOT IMPLEMENTED — only `keywords:pi-package` |
| Documentation (README, FAQ, file-index) | NOT IMPLEMENTED |
| End-to-end verification | NOT IMPLEMENTED |

### Forward path

To close the gap, implement:

1. Add `loadGlobalPiPackages()` reading `~/.pi/agent/settings.json#packages[]`.
2. Extend `discoverPlugins()` with an optional resolver seam (or wire directly) to scan resolved entries from settings, maintaining existing dedup with workspace > installed > bundled > global.
3. Add `source` to `PluginStatus`/`DiscoveredPlugin`.
4. Wire `recomputeAndBroadcastPlugins()` into `package-routes.ts` success branches.
5. Add `plugins_changed` to `browser-protocol.ts`.
6. Accept `pi-dashboard-plugin` in `npm-search-proxy.ts`.
